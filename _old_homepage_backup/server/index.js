const express = require('express');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { google } = require('googleapis');
const https = require('https');
const multer = require('multer');

// 외부 라이브러리(dotenv) 없이 로컬 .env 파일의 환경 변수를 메모리로 로드합니다.
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
    try {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split(/\r?\n/).forEach(line => {
            const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
            if (match) {
                const key = match[1];
                let value = match[2] || '';
                if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.substring(1, value.length - 1);
                } else if (value.startsWith("'") && value.endsWith("'")) {
                    value = value.substring(1, value.length - 1);
                }
                process.env[key] = value.trim();
            }
        });
        console.log('[Env] Loaded local .env configuration.');
    } catch (e) {
        console.error('[Env] Failed to parse local .env file:', e.message);
    }
}

/**
 * LINE Notify API를 사용하여 관리자 등록 채널로 실시간 알림을 발송합니다.
 * 어떠한 비동기 네트워크 예외나 환경적 차이도 메인 주문 API에 해를 끼치지 않고 완전히 격리시킵니다.
 * @param {string} message 전송할 텍스트 메시지
 */
function sendLineNotification(message) {
    try {
        const token = process.env.LINE_NOTIFY_TOKEN;
        if (!token) {
            console.log('[LINE] LINE_NOTIFY_TOKEN이 설정되지 않아 알림 전송을 건너뜁니다.');
            return;
        }

        // URLSearchParams 대신 100% 안전하고 구버전 node 호환성이 보장되는 encodeURIComponent 사용
        const payload = `message=${encodeURIComponent(message)}`;

        const options = {
            hostname: 'notify-api.line.me',
            path: '/api/notify',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Bearer ${token}`,
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const req = https.request(options, (res) => {
            try {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    console.log(`[LINE] Notify 발송 완료 (Status: ${res.statusCode}), Response: ${data}`);
                });
            } catch (innerErr) {
                console.error('[LINE] Response 파싱 에러:', innerErr.message);
            }
        });

        req.on('error', (err) => {
            console.error('[LINE] Notify 전송 중 네트워크 에러 발생 (건너뜀):', err.message);
        });

        // 5초 타임아웃 보장
        req.setTimeout(5000, () => {
            try {
                req.destroy();
                console.error('[LINE] Notify 전송 타임아웃 초과 (요청 폐기)');
            } catch (timeoutErr) {
                // 완전히 격리
            }
        });

        req.write(payload);
        req.end();
    } catch (globalErr) {
        console.error('[LINE] sendLineNotification 전역 예외 처리:', globalErr.message);
    }
}

const SPREADSHEET_ID = '1qPfxy3ZF6ZISgPxRwNVYvHC9Qj57lgMeTd_FjN8cdF8';
const SERVICE_ACCOUNT_PATH = (() => {
    const paths = [
        path.resolve(process.cwd(), 'service_account.json'),
        path.resolve(process.cwd(), 'catalog_app_v2', 'service_account.json'),
        path.resolve(__dirname, '..', '..', 'service_account.json'),
        path.resolve(__dirname, 'service_account.json')
    ];
    return paths.find(p => fs.existsSync(p)) || paths[0];
})();
const NOTICES_SHEET = '공지사항';
const CUSTOMERS_SHEET = '등록고객';
const COUPONS_SHEET = '쿠폰관리';

const ORDERS_SHEET = '주문내역';
const CONSIGNMENT_SHEET = '위탁제품';
const SETTINGS_SHEET = '사이트설정'; // 추가
const DISCOUNTS_SHEET = '할인상품관리'; // 할인 상품 동기화용

// In-memory notices cache (5-minute TTL)
let noticesCache = { data: null, expiresAt: 0 };

// 방문자 통계 보존을 위한 Baseline (구글 시트에서 불러옴)
let trafficBaseline = { totalVisitors: 0, totalViews: 0 };

// 공통 Google Sheets 인증 헬퍼 (notices, shipping 등에서 재사용)
// 읽기 전용 인증 (공지사항 등 기존 기능용)
async function getGoogleSheetsAuth() {
    if (process.env.GOOGLE_SERVICE_ACCOUNT) {
        try {
            const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
            return new google.auth.GoogleAuth({
                credentials,
                scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
            });
        } catch (err) {
            console.error('[Auth] Error parsing GOOGLE_SERVICE_ACCOUNT env var:', err.message);
        }
    }
    return new google.auth.GoogleAuth({
        keyFile: SERVICE_ACCOUNT_PATH,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
}

// 읽기+쓰기 인증 (회원 데이터 기록용 - POS 연동)
async function getGoogleSheetsWriteAuth() {
    if (process.env.GOOGLE_SERVICE_ACCOUNT) {
        try {
            const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
            return new google.auth.GoogleAuth({
                credentials,
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
        } catch (err) {
            console.error('[Auth] Error parsing GOOGLE_SERVICE_ACCOUNT (write) env var:', err.message);
        }
    }
    return new google.auth.GoogleAuth({
        keyFile: SERVICE_ACCOUNT_PATH,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
}

// [Order] 결제 취소 시 '주문내역' 시트에서 해당 행의 상태를 'cancelled'로 업데이트하는 헬퍼 함수
// (기존: POS_매출기록에서 행 삭제 → 변경: 주문내역에서 상태만 cancelled로 변경하여 이력 보존)
async function deleteSalesRecords(productCodes, orderNumber) {
    if (!productCodes || productCodes.length === 0 || !orderNumber) return;
    try {
        const auth = await getGoogleSheetsWriteAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        
        // 1. 주문내역 시트 조회 (A열: 주문번호, K열: 상태)
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${ORDERS_SHEET}!A:K`,
        });
        const rows = res.data.values || [];
        if (rows.length <= 1) return;
        
        // 2. 해당 주문번호에 해당하는 행을 찾아 상태를 'cancelled'로 변경
        const rowUpdates = [];
        for (let i = 1; i < rows.length; i++) {
            const rowOrderNumber = rows[i][0]; // A열: 주문번호
            if (rowOrderNumber === orderNumber) {
                rowUpdates.push({
                    range: `${ORDERS_SHEET}!K${i + 1}`,
                    values: [['cancelled']]
                });
            }
        }
        
        if (rowUpdates.length === 0) {
            console.log(`[Order] No rows found in ${ORDERS_SHEET} for order: ${orderNumber}`);
            return;
        }
        
        // 3. BatchUpdate로 상태 업데이트 (행 삭제 대신 이력 보존)
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: rowUpdates
            }
        });
        
        console.log(`[Order] Marked ${rowUpdates.length} rows as 'cancelled' in ${ORDERS_SHEET} for order ${orderNumber}`);
    } catch (err) {
        console.error('[Order] deleteSalesRecords error:', err.message);
        throw err; // 오류를 상위로 전파하여 클라이언트에 에러 응답
    }
}

// [POS] 구글 시트 '사입품목' 및 '상품목록' 탭의 재고 상태(N열) 및 실제판매가격(V열)을 업데이트하는 헬퍼 함수
async function syncStockToGoogleSheets(productCodes, status = 'Sold Out', priceMap = {}) {
    // priceMap: { 상품코드: 실제판매가(숫자) } — V열(실제판매가격(정산용)) 기록용
    if (!productCodes || productCodes.length === 0) return;
    try {
        const auth = await getGoogleSheetsWriteAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        
        // 1. '사입품목' 및 '상품목록' 두 시트에서 병렬로 데이터를 긁어옴
        const [resPurchases, resProducts] = await Promise.all([
            sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: '사입품목!A:AF' }),
            sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: '상품목록!A:AF' }).catch(err => {
                console.log("[Inventory] '상품목록' 시트가 존재하지 않아 조회를 스킵합니다.");
                return { data: { values: [] } };
            })
        ]);
        
        const purchaseRows = resPurchases.data.values || [];
        const productRows = resProducts.data.values || [];
        
        const updates = [];
        const cleanCodes = productCodes.map(c => String(c).replace('.0', '').trim());

        // A. 사입품목 시트 업데이트 대상 스캔
        if (purchaseRows.length > 1) {
            for (let i = 1; i < purchaseRows.length; i++) {
                const pCode = String(purchaseRows[i][0]).replace('.0', '').trim();
                if (cleanCodes.includes(pCode)) {
                    // F열: 재고 상태 업데이트
                    updates.push({
                        range: `사입품목!F${i + 1}`,
                        values: [[status]]
                    });
                    // I열: 실제판매가격(정산용) 업데이트 — status가 'Sold Out'일 때만 기록
                    if (status === 'Sold Out' && priceMap[pCode] !== undefined) {
                        updates.push({
                            range: `사입품목!J${i + 1}`,
                            values: [[priceMap[pCode]]]
                        });
                        console.log(`[POS] 사입품목 I열 실제판매가 기록: 상품코드=${pCode}, 가격=${priceMap[pCode]}`);
                    }
                }
            }
        }

        // B. 상품목록 시트 업데이트 대상 스캔
        if (productRows.length > 1) {
            for (let i = 1; i < productRows.length; i++) {
                const pCode = String(productRows[i][0]).replace('.0', '').trim();
                if (cleanCodes.includes(pCode)) {
                    // F열: 재고 상태 업데이트
                    updates.push({
                        range: `상품목록!F${i + 1}`,
                        values: [[status]]
                    });
                    // J열: 실제판매가격(정산용) 업데이트 — status가 'Sold Out'일 때만 기록
                    if (status === 'Sold Out' && priceMap[pCode] !== undefined) {
                        updates.push({
                            range: `상품목록!J${i + 1}`,
                            values: [[priceMap[pCode]]]
                        });
                        console.log(`[POS] 상품목록 I열 실제판매가 기록: 상품코드=${pCode}, 가격=${priceMap[pCode]}`);
                    }
                }
            }
        }
        
        if (updates.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data: updates
                }
            });
            console.log(`[Inventory] Synced '${status}' to Google Sheets [사입품목 / 상품목록] for: ${cleanCodes.join(', ')}`);
        }
    } catch (err) {
        console.error('[Inventory] syncStockToGoogleSheets error:', err.message);
    }
}

/**
 * [Sync] 구글 시트에서 누적 방문자 수 기본값(Baseline) 로드
 */
async function loadTrafficBaseline() {
    try {
        const auth = await getGoogleSheetsAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        
        console.log(`[Traffic] Loading baseline stats from ${SETTINGS_SHEET}...`);
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SETTINGS_SHEET}!A2:C2`, // A: 누적방문자, B: 누적조회수, C: 틱톡링크
        });

        const row = res.data.values ? res.data.values[0] : null;
        if (row) {
            trafficBaseline = {
                totalVisitors: Number(row[0]) || 0,
                totalViews: Number(row[1]) || 0
            };
            const tiktokUrl = row[2] || '';
            console.log(`[Traffic] Loaded baseline: Visitors=${trafficBaseline.totalVisitors}, Views=${trafficBaseline.totalViews}, TikTok=${tiktokUrl}`);

            // 틱톡 링크가 시트에 있으면 SQLite 복구 (배포 시 초기화 방지)
            if (tiktokUrl) {
                db.run('INSERT OR REPLACE INTO site_settings (setting_key, setting_value) VALUES (?, ?)', ['tiktok_live_url', tiktokUrl]);
            }
        } else {
            console.log('[Traffic] No baseline data found in Sheets. Using 0.');
        }
    } catch (err) {
        console.error('[Traffic] Load baseline error (ignored):', err.message);
    }
}

/**
 * [Sync] 현재 SQLite의 통계 데이터를 구글 시트에 백업 (Baseline 업데이트)
 * 배포 전/후 또는 수동 동기화 시 호출됨
 */
async function backupTrafficToSheets() {
    try {
        const auth = await getGoogleSheetsWriteAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        // 시트 존재 여부 확인 및 생성 로직
        try {
            await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SETTINGS_SHEET}!A1`,
            });
        } catch (e) {
            if (e.message.includes('range') || e.code === 400) {
                console.log(`[Traffic] ${SETTINGS_SHEET} 시트가 없어 새로 생성합니다...`);
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    requestBody: {
                        requests: [{ addSheet: { properties: { title: SETTINGS_SHEET } } }]
                    }
                });
            }
        }

        // 1. 현재 SQLite 누적 데이터 확인 (방문자)
        const stats = await new Promise((resolve) => {
            db.get('SELECT COUNT(DISTINCT ip_address) as visitors, COUNT(*) as views FROM page_views', [], (err, row) => {
                resolve(row || { visitors: 0, views: 0 });
            });
        });

        // 2. 현재 SQLite 사이트 설정 확인 (틱톡 링크)
        const tiktokUrl = await new Promise((resolve) => {
            db.get('SELECT setting_value FROM site_settings WHERE setting_key = ?', ['tiktok_live_url'], (err, row) => {
                resolve(row?.setting_value || '');
            });
        });

        // 3. Baseline + Current 데이터 합산
        const finalVisitors = trafficBaseline.totalVisitors + stats.visitors;
        const finalViews = trafficBaseline.totalViews + stats.views;

        console.log(`[Traffic] Backup to Google Sheets: Total Visitors=${finalVisitors}, Total Views=${finalViews}, TikTok=${tiktokUrl}`);

        // 4. 구글 시트 업데이트
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SETTINGS_SHEET}!A1:C2`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [
                    ['Total Visitors (Baseline)', 'Total Views (Baseline)', 'TikTok Live URL'],
                    [finalVisitors, finalViews, tiktokUrl]
                ]
            }
        });

        trafficBaseline = { totalVisitors: finalVisitors, totalViews: finalViews };
        return true;
    } catch (err) {
        console.error('[Traffic] Backup error:', err.message);
        return false;
    }
}

/**
 * [Sync] 구글 시트 '등록고객' 데이터를 SQLite 'managed_customers' 테이블로 동기화
 * 서버 시작 시 호출되어 DB가 비어있거나 초기화된 경우 데이터를 복구함
 */
async function syncManagedCustomersFromSheets() {
    try {
        const auth = await getGoogleSheetsAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        
        console.log(`[Sync] Fetching managed customers from Google Sheets (${CUSTOMERS_SHEET})...`);
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${CUSTOMERS_SHEET}!A:D`,
        });

        const rows = res.data.values || [];
        if (rows.length <= 1) {
            console.log('[Sync] No managed customers found in Google Sheets.');
            return;
        }

        // 헤더 제외: [아이디, 전화번호, 주소, 업데이트 일시]
        const customers = rows.slice(1);
        let syncCount = 0;

        db.serialize(() => {
            const stmt = db.prepare(`
                INSERT OR REPLACE INTO managed_customers (customer_id, phone, address, updated_at)
                VALUES (?, ?, ?, ?)
            `);

            customers.forEach(row => {
                const [c_id, c_phone, c_address, c_updated] = row;
                if (c_id && c_id.trim()) {
                    stmt.run(c_id.trim(), c_phone || '', c_address || '', c_updated || new Date().toISOString());
                    syncCount++;
                }
            });

            stmt.finalize();
            console.log(`[Sync] Successfully synced ${syncCount} managed customers from Google Sheets.`);
        });
    } catch (err) {
        console.error('[Sync] Managed customers sync error:', err.message);
    }
}

/**
 * [Sync] 구글 시트 '할인상품관리' 데이터를 SQLite 'discount_products' 테이블로 동기화
 */

/**
 * [Sync] 구글 시트 '쿠폰관리' 데이터를 SQLite 'coupons' 테이블로 동기화
 */
async function syncCouponsFromSheets() {
    try {
        const auth = await getGoogleSheetsAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        
        console.log(`[Sync] Fetching coupons from Google Sheets (${COUPONS_SHEET})...`);
        
        let rows = [];
        try {
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${COUPONS_SHEET}!A:G`,
            });
            rows = res.data.values || [];
        } catch (e) {
            console.log(`[Sync] ${COUPONS_SHEET} 시트를 읽을 수 없습니다.`);
            return;
        }

        if (rows.length <= 1) {
            console.log('[Sync] No coupons found in Google Sheets.');
            return;
        }

        const couponsData = rows.slice(1);
        let syncCount = 0;

        db.serialize(() => {
            const stmt = db.prepare(`
                INSERT OR REPLACE INTO coupons (code, type, value, expires_at, is_used, used_at, order_number)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            couponsData.forEach(row => {
                const code = row[0];
                if (!code) return;
                
                const rawType = row[1] || '';
                const type = rawType.includes('%') || rawType === 'rate' ? 'rate' : 'amount';
                const value = parseInt(row[2]) || 0;
                const expiresAt = row[3] || '';
                const isUsed = (row[4] && row[4] !== '미사용') ? 1 : 0;
                const usedAt = row[5] || '';
                const orderNum = row[6] || '';

                stmt.run([code.trim(), type, value, expiresAt, isUsed, usedAt, orderNum]);
                syncCount++;
            });

            stmt.finalize();
            console.log(`[Sync] Successfully synced ${syncCount} coupons from Google Sheets.`);
        });
    } catch (err) {
        console.error('[Sync] Coupons sync error:', err.message);
    }
}

async function syncDiscountsFromSheets() {
    try {
        const auth = await getGoogleSheetsAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        
        console.log(`[Sync] Fetching discounts from Google Sheets (${DISCOUNTS_SHEET})...`);
        
        // 시트 존재 여부 확인
        let rows = [];
        try {
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${DISCOUNTS_SHEET}!A:C`,
            });
            rows = res.data.values || [];
        } catch (e) {
            if (e.message.includes('range') || e.code === 400) {
                console.log(`[Sync] ${DISCOUNTS_SHEET} 시트가 없어 새로 생성합니다...`);
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    requestBody: {
                        requests: [{ addSheet: { properties: { title: DISCOUNTS_SHEET } } }]
                    }
                });
                return; // 처음 생성했으므로 비어있음
            } else {
                throw e;
            }
        }

        if (rows.length <= 1) {
            console.log('[Sync] No discount products found in Google Sheets.');
            // 시트가 비어있다면, 로컬 SQLite도 비워줌 (Source of Truth가 시트이므로)
            db.run('DELETE FROM discount_products', (err) => {
                if (err) console.error('[Sync] Error clearing local discounts:', err.message);
            });
            return;
        }

        const discounts = rows.slice(1);
        let syncCount = 0;

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            // 로컬 DB 비우고 시트 데이터로 덮어쓰기
            db.run('DELETE FROM discount_products');
            
            const stmt = db.prepare(`
                INSERT INTO discount_products (product_code, discount_rate, registered_at)
                VALUES (?, ?, ?)
            `);

            discounts.forEach(row => {
                const [pCode, dRate, rAt] = row;
                if (pCode && String(pCode).trim()) {
                    const code = String(pCode).trim();
                    const rate = parseInt(dRate, 10) || 0;
                    const registeredAt = rAt || new Date().toISOString();
                    stmt.run(code, rate, registeredAt);
                    syncCount++;
                }
            });

            stmt.finalize();
            db.run('COMMIT', (err) => {
                if (err) console.error('[Sync] Commit error during discount sync:', err.message);
                else console.log(`[Sync] Successfully synced ${syncCount} discount products from Google Sheets.`);
            });
        });
    } catch (err) {
        console.error('[Sync] Discounts sync error:', err.message);
    }
}

/**
 * [Sync] SQLite 'discount_products' 테이블 데이터를 구글 시트에 백업
 */
async function backupDiscountsToSheets() {
    try {
        const auth = await getGoogleSheetsWriteAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        db.all('SELECT product_code, discount_rate, registered_at FROM discount_products ORDER BY registered_at DESC', [], async (err, rows) => {
            if (err) {
                console.error('[Discount] SQLite fetch error:', err.message);
                return;
            }

            const values = [['상품번호', '할인율(%)', '등록시간']];
            rows.forEach(row => {
                values.push([row.product_code, row.discount_rate, row.registered_at]);
            });

            try {
                // 기존 데이터 클리어 (헤더 포함 전체)
                await sheets.spreadsheets.values.clear({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${DISCOUNTS_SHEET}!A:C`
                });

                // 새 데이터 덮어쓰기
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${DISCOUNTS_SHEET}!A1`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values }
                });
                
                console.log(`[Discount] Successfully backed up ${rows.length} discounts to Google Sheets.`);
            } catch (sheetErr) {
                if (sheetErr.message.includes('range') || sheetErr.code === 400) {
                    console.log(`[Discount] ${DISCOUNTS_SHEET} 시트가 없어서 백업을 스킵합니다. (다음 동기화 때 생성됨)`);
                } else {
                    console.error('[Discount] Google Sheets update error:', sheetErr.message);
                }
            }
        });
    } catch (err) {
        console.error('[Discount] Backup discounts error:', err.message);
    }
}

async function fetchNoticesFromSheets() {
    if (noticesCache.data && Date.now() < noticesCache.expiresAt) {
        return noticesCache.data;
    }
    try {
        const auth = await getGoogleSheetsAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${NOTICES_SHEET}!A:E`,
        });
        const rows = res.data.values || [];
        if (rows.length <= 1) {
            noticesCache = { data: [], expiresAt: Date.now() + 5 * 60 * 1000 };
            return [];
        }
        const headers = rows[0];
        const notices = rows.slice(1)
            .map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] || ''])))
            .filter(n => n.title)
            .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        noticesCache = { data: notices, expiresAt: Date.now() + 5 * 60 * 1000 };
        return notices;
    } catch (err) {
        console.error('[Notices] Google Sheets error:', err.message);
        return noticesCache.data || [];
    }
}

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// WWW 및 HTTPS 자동 리다이렉트 미들웨어
app.use((req, res, next) => {
    const host = req.get('host');
    // 822shop.com으로 접속하면 인증서가 안전한 www.822shop.com으로 이동시킴
    if (host === '822shop.com') {
        console.log(`[Redirect] Redirecting non-www to www: ${host}${req.url}`);
        return res.redirect(301, `https://www.822shop.com${req.url}`);
    }
    next();
});

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// 정적 파일 경로 설정 (Railway Flat Deployment 및 로컬 계층 구조 모두 대응)
const findDistPath = () => {
    const candidates = [
        path.resolve(process.cwd(), 'client', 'dist'),
        path.resolve(process.cwd(), 'client', 'dist_prebuilt'),
        path.resolve(process.cwd(), 'catalog_app_v2', 'client', 'dist'),
        path.resolve(process.cwd(), 'catalog_app_v2', 'client', 'dist_prebuilt'),
        path.resolve(__dirname, 'client', 'dist'),
        path.resolve(__dirname, 'client', 'dist_prebuilt'),
        path.resolve(__dirname, '..', 'client', 'dist'),
        path.resolve(__dirname, '..', 'client', 'dist_prebuilt')
    ];
    for (const c of candidates) {
        if (fs.existsSync(path.join(c, 'index.html'))) return c;
    }
    return candidates[0]; // 기본값
};


const CLIENT_DIST_PATH = findDistPath();
const STATIC_ASSETS_PATH = (() => {
    const candidates = [
        path.resolve(process.cwd(), 'static'),
        path.resolve(process.cwd(), 'catalog_app_v2', 'static'),
        path.resolve(__dirname, 'static'),
        path.resolve(__dirname, '..', '..', 'static')
    ];
    return candidates.find(c => fs.existsSync(c)) || candidates[0];
})();

console.log(`[Init] CWD: ${process.cwd()}`);
console.log(`[Init] Resolved Client Dist: ${CLIENT_DIST_PATH}`);
console.log(`[Init] Resolved Static Assets: ${STATIC_ASSETS_PATH}`);

let dbPath = path.resolve(__dirname, '..', 'db', 'database.sqlite');
if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    dbPath = path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'database.sqlite');
    console.log(`[Init] Using Railway Volume at: ${dbPath}`);
} else if (process.env.DB_PATH) {
    dbPath = process.env.DB_PATH;
}

const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// [Fix] 업로드된 이미지가 배포 시 날아가지 않도록 DB와 동일한 영구 스토리지에 저장
let persistentUploadsPath = path.join(dbDir, 'main_images');
if (!fs.existsSync(persistentUploadsPath)) {
    fs.mkdirSync(persistentUploadsPath, { recursive: true });
}

// 우선 영구 저장소에서 이미지를 제공하고, 없으면 로컬 에셋에서 제공
app.use('/static/main_images', express.static(persistentUploadsPath, { maxAge: '7d' }));
app.use('/static/main_images', express.static(path.join(STATIC_ASSETS_PATH, 'main_images'), { maxAge: '7d' }));

// Serve static images
app.use('/static', express.static(STATIC_ASSETS_PATH, { maxAge: '7d' }));

// Serve React production build
app.use(express.static(CLIENT_DIST_PATH));

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('[DB] Error opening database:', err.message);
    } else {
        console.log(`[DB] Connected to SQLite database at: ${dbPath}`);
    }
});

// =============================================
// 고객(회원) 테이블 자동 생성
// 서버 시작 시 테이블이 없으면 자동으로 만들어줌
// 라인 ID를 UNIQUE로 설정하여 중복 가입 방지
// =============================================
db.serialize(() => {
    // 1. 고객(회원) 테이블
    db.run(`
        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            login_id TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            line_id TEXT NOT NULL UNIQUE,
            phone TEXT NOT NULL,
            province TEXT NOT NULL,
            district TEXT NOT NULL,
            sub_district TEXT NOT NULL,
            postal_code TEXT NOT NULL,
            address_detail TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    `);

    // login_id, password 컬럼 추가 (기존 사용자 대응)
    db.run("ALTER TABLE customers ADD COLUMN login_id TEXT", (err) => {});
    db.run("ALTER TABLE customers ADD COLUMN password TEXT", (err) => {});
    db.run("ALTER TABLE customers ADD COLUMN address_kr TEXT", (err) => {});
    db.run("ALTER TABLE customers ADD COLUMN role TEXT DEFAULT 'user'", (err) => {
        // [Admin Safeguard] youini07 계정 자동 생성 및 권한 보장
        db.get("SELECT id FROM customers WHERE LOWER(login_id) = 'youini07'", async (err, row) => {
            if (!row) {
                const defaultPw = await bcrypt.hash('admin1234', 10);
                db.run(`INSERT INTO customers 
                    (login_id, password, name, line_id, phone, province, district, sub_district, postal_code, address_detail, role)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    ['youini07', defaultPw, 'Admin', 'admin_safe', '000', 'Admin', 'Admin', 'Admin', '00000', 'Auto Generated', 'admin']
                );
            } else {
                db.run("UPDATE customers SET role = 'admin' WHERE LOWER(login_id) = 'youini07'");
            }
        });
    });

    // 2. 장바구니 테이블
    db.run(`
        CREATE TABLE IF NOT EXISTS cart (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            product_code TEXT NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            added_at TEXT DEFAULT (datetime('now', 'localtime')),
            UNIQUE(customer_id, product_code),
            FOREIGN KEY (customer_id) REFERENCES customers(id)
        )
    `);

    // 3. 위시리스트(찜하기) 테이블
    db.run(`
        CREATE TABLE IF NOT EXISTS wishlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            product_code TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            UNIQUE(customer_id, product_code)
        )
    `);

    // 4. 주문 테이블
    db.run(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_number TEXT NOT NULL UNIQUE,
            customer_id INTEGER NOT NULL,
            customer_name TEXT NOT NULL,
            line_id TEXT NOT NULL,
            phone TEXT NOT NULL,
            items_json TEXT NOT NULL,
            total_amount INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            shipping_address TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (customer_id) REFERENCES customers(id)
        )
    `);
    db.run("ALTER TABLE orders ADD COLUMN tracking_number TEXT", (err) => {});
    db.run("ALTER TABLE orders ADD COLUMN tracking_company TEXT", (err) => {});

    // 4. 위탁판매 아이템 테이블
    db.run(`
        CREATE TABLE IF NOT EXISTS consignment_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_code TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            registered_at TEXT DEFAULT (datetime('now', 'localtime')),
            sold_at TEXT
        )
    `);

    // 5. 관리자 등록 고객 테이블
    db.run(`
        CREATE TABLE IF NOT EXISTS managed_customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id TEXT NOT NULL UNIQUE,
            phone TEXT DEFAULT '',
            address TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    `, (err) => {
        if (!err) {
            syncManagedCustomersFromSheets();
            loadTrafficBaseline();
        }
    });

    // 6. 페이지 뷰 기록 테이블
    db.run(`
        CREATE TABLE IF NOT EXISTS page_views (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL,
            referrer TEXT,
            user_agent TEXT,
            ip_address TEXT,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    `);

    // 7. 사이트 설정 테이블
    db.run(`
        CREATE TABLE IF NOT EXISTS site_settings (
            setting_key TEXT PRIMARY KEY,
            setting_value TEXT NOT NULL
        )
    `);

    // 8. 특별할인 상품 테이블
    db.run(`
        CREATE TABLE IF NOT EXISTS discount_products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_code TEXT NOT NULL UNIQUE,
            discount_rate INTEGER NOT NULL DEFAULT 0,
            registered_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    `, (err) => {
        if (err) console.error('[DB] discount_products 테이블 생성 에러:', err.message);
    });

    // 9. 쿠폰 테이블
    db.run(`
        CREATE TABLE IF NOT EXISTS coupons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            type TEXT NOT NULL, -- 'amount' or 'rate'
            value INTEGER NOT NULL,
            expires_at TEXT NOT NULL,
            is_used INTEGER DEFAULT 0,
            used_at TEXT,
            order_number TEXT,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    `, (err) => {
        if (err) console.error('[DB] coupons 테이블 생성 에러:', err.message);
        else {
    // 10. 홈 화면 추천 테마 테이블
    db.run(`
        CREATE TABLE IF NOT EXISTS home_themes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            filter_gender TEXT,
            filter_upper_category TEXT,
            filter_category TEXT,
            filter_brand TEXT,
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    `, (err) => {
        if (err) console.error('[DB] home_themes 테이블 생성 에러:', err.message);
        else {
            db.run("ALTER TABLE home_themes ADD COLUMN filter_gender TEXT", (err) => {});
            db.run("ALTER TABLE home_themes ADD COLUMN filter_upper_category TEXT", (err) => {});
            // 왜: '최근 업로드 N개' 테마 모드를 지원하기 위한 컬럼 추가
            // filter_mode: 'filter'(기존 필터방식) 또는 'recent'(최근 업로드)
            // max_items: 테마에 표시할 상품 수 (기본 10개)
            db.run("ALTER TABLE home_themes ADD COLUMN filter_mode TEXT DEFAULT 'filter'", (err) => {});
            db.run("ALTER TABLE home_themes ADD COLUMN max_items INTEGER DEFAULT 10", (err) => {});
            db.run("ALTER TABLE home_themes ADD COLUMN filter_season TEXT", (err) => {});
            
            // 추천 브랜드 테이블
            db.run(`
                CREATE TABLE IF NOT EXISTS recommended_brands (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    group_name TEXT NOT NULL,
                    brand_name TEXT NOT NULL,
                    description_kr TEXT,
                    description_en TEXT,
                    description_th TEXT,
                    hero_image_url TEXT,
                    logo_url TEXT,
                    sort_order INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('[DB] recommended_brands 테이블 생성 에러:', err.message);
                } else {
                    // 호환성: 기존 테이블에 created_at 컬럼 추가 (실패시 무시)
                    db.run("ALTER TABLE recommended_brands ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP", () => {});
                }
            });

            // 11. 메인 캐러셀 배너 테이블
            db.run(`
                CREATE TABLE IF NOT EXISTS main_banners (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    image_url TEXT NOT NULL,
                    link_url TEXT,
                    title TEXT,
                    subtitle TEXT,
                    sort_order INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT (datetime('now', 'localtime'))
                )
            `, (err) => {
                if (err) console.error('[DB] main_banners 테이블 생성 에러:', err.message);
                else {
                    console.log('[DB] 모든 테이블 준비 완료.');
                    syncCouponsFromSheets();
                    syncDiscountsFromSheets();
                }
            });
        }
    });
        }
    });

});

app.get('/api/settings/:key', (req, res) => {
    const { key } = req.params;
    db.get('SELECT setting_value FROM site_settings WHERE setting_key = ?', [key], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ key, value: row ? row.setting_value : null });
    });
});

app.post('/api/admin/settings', (req, res) => {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'Key is required' });
    
    db.run(
        'INSERT OR REPLACE INTO site_settings (setting_key, setting_value) VALUES (?, ?)',
        [key, value || ''],
        async function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            // 링크 주소 변경 시 즉시 구글 시트에도 백업 (사이트 설정 영구 보존)
            await backupTrafficToSheets();
            
            res.json({ success: true, key, value });
        }
    );
});


// ─── 할인 상품 API ────────────────────────────────

/**
 * 만료된 할인 상품 자동 삭제 (등록일 + 7일 후 자정)
 */
function cleanupExpiredDiscounts(callback) {
    const sql = `
        DELETE FROM discount_products 
        WHERE datetime('now', 'localtime') >= datetime(registered_at, '+8 days', 'start of day')
    `;
    db.run(sql, function(err) {
        if (err) console.error('[Discount] Cleanup error:', err.message);
        else if (this.changes > 0) {
            console.log(`[Discount] ${this.changes}개의 만료된 할인 상품이 삭제되었습니다.`);
            backupDiscountsToSheets();
        }
        if (callback) callback();
    });
}

/**
 * GET /api/discounts
 * 모든 할인 상품 목록 (products 테이블 JOIN)
 * 상품 정보가 DB에 없으면 code + rate만 반환
 */
app.get('/api/discounts', (req, res) => {
    cleanupExpiredDiscounts(() => {
        const sql = `
            SELECT d.id, d.product_code, d.discount_rate, d.registered_at,
                   p.name, p.brand, p.price, p.original_price, p.stock, p.thumbnail_url, p.image_url, p.category
            FROM discount_products d
            LEFT JOIN products p ON p.code = d.product_code
            ORDER BY d.registered_at DESC
        `;
        db.all(sql, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ discounts: rows });
        });
    });
});

/**
 * GET /api/discounts/featured
 * 홈 상단 노출용 — 등록된 할인 상품 중 최대 8개 반환
 * 할인율 높은 순으로 정렬
 */
app.get('/api/discounts/featured', (req, res) => {
    cleanupExpiredDiscounts(() => {
        const sql = `
            SELECT d.product_code, d.discount_rate, d.registered_at,
                   p.name, p.brand, p.price, p.original_price, p.stock, p.thumbnail_url, p.image_url, p.category, p.code
            FROM discount_products d
            LEFT JOIN products p ON p.code = d.product_code
            WHERE d.discount_rate > 0
            ORDER BY d.discount_rate DESC, d.registered_at DESC
            LIMIT 8
        `;
        db.all(sql, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ featured: rows });
        });
    });
});

/**
 * POST /api/admin/discounts
 * 할인 상품 일괄 등록
 * body: { codes: ['841', '231', ...], discount_rate: 30 }
 * 이미 등록된 코드는 무시 (INSERT OR IGNORE), 만약 discount_rate가 주어진 경우 해당 할인율도 업데이트
 */
app.post('/api/admin/discounts', (req, res) => {
    const { codes, discount_rate = 0 } = req.body;
    const rate = parseInt(discount_rate, 10) || 0;

    if (!Array.isArray(codes) || codes.length === 0) {
        return res.status(400).json({ error: 'codes 배열이 필요합니다.' });
    }

    // 코드 정리: 공백 제거, 빈 값 제외
    const cleanCodes = codes.map(c => String(c).trim()).filter(c => c.length > 0);
    if (cleanCodes.length === 0) {
        return res.status(400).json({ error: '유효한 상품 코드가 없습니다.' });
    }

    let insertedCount = 0;
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        const stmtInsert = db.prepare('INSERT OR IGNORE INTO discount_products (product_code, discount_rate) VALUES (?, ?)');
        const stmtUpdate = db.prepare('UPDATE discount_products SET discount_rate = ? WHERE product_code = ?');
        
        cleanCodes.forEach(code => {
            stmtInsert.run(code, rate, function(err) {
                if (!err && this.changes > 0) insertedCount++;
            });
            if (rate > 0) {
                stmtUpdate.run(rate, code);
            }
        });
        
        stmtInsert.finalize();
        stmtUpdate.finalize();
        
        db.run('COMMIT', async (err) => {
            if (err) return res.status(500).json({ error: err.message });
            console.log(`[Discount] ${insertedCount}개 할인 상품 등록됨 (적용 할인율: ${rate}%)`);
            await backupDiscountsToSheets();
            res.json({ success: true, insertedCount, appliedRate: rate, totalRequested: cleanCodes.length });
        });
    });
});

/**
 * PUT /api/admin/discounts/:code
 * 특정 상품의 할인율 수정
 * body: { discount_rate: 30 }
 */
app.put('/api/admin/discounts/:code', (req, res) => {
    const { code } = req.params;
    const { discount_rate } = req.body;
    const rate = parseInt(discount_rate, 10);

    if (isNaN(rate) || rate < 0 || rate > 100) {
        return res.status(400).json({ error: '할인율은 0~100 사이의 숫자여야 합니다.' });
    }

    db.run(
        'UPDATE discount_products SET discount_rate = ? WHERE product_code = ?',
        [rate, code],
        async function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: '해당 상품을 찾을 수 없습니다.' });
            console.log(`[Discount] 상품 ${code} 할인율 ${rate}% 로 업데이트`);
            await backupDiscountsToSheets();
            res.json({ success: true, product_code: code, discount_rate: rate });
        }
    );
});

/**
 * DELETE /api/admin/discounts/:code
 * 할인 상품 등록 해제
 */
app.delete('/api/admin/discounts/:code', (req, res) => {
    const { code } = req.params;
    db.run('DELETE FROM discount_products WHERE product_code = ?', [code], async function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '해당 상품을 찾을 수 없습니다.' });
        console.log(`[Discount] 상품 ${code} 할인 해제`);
        await backupDiscountsToSheets();
        res.json({ success: true, product_code: code });
    });
});

// ─────────────────────────────────────────────────

// =============================================
// 브랜드 동적 정규화 시스템
// DB에서 가져온 브랜드를 유사도 기반으로 자동 그룹핑
// 대표 이름 = 해당 그룹에서 가장 많은 상품을 가진 원본 이름
// =============================================

// 브랜드 캐시 (서버 시작 시 & 주기적 갱신)
let brandCache = {
    // normalizedMap: { 'lowercase_name' -> '대표 이름' }
    normalizedMap: {},
    // groupMap: { '대표 이름' -> ['alias1_lower', 'alias2_lower', ...] }
    groupMap: {},
    // topBrands: 상위 10개 (정규화 후 기준)
    topBrands: [],
    // 전체 브랜드 리스트 (정규화 후, 정렬됨)
    allBrands: [],
    expiresAt: 0
};

/**
 * 악센트/다이아크리틱 제거 (é→e, ç→c, ñ→n 등)
 */
function removeAccents(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * 브랜드명을 정규화된 키로 변환 (비교용)
 * - 소문자로 변환
 * - 악센트 제거
 * - 공백, 하이픈, 특수문자(&, ', ·, .) 모두 제거
 */
function brandKey(name) {
    return removeAccents(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * 브랜드명에서 첫 번째 의미 있는 단어 추출 (4자 이상)
 */
function firstToken(name) {
    const cleaned = removeAccents(name).toLowerCase().replace(/[^a-z0-9\s]/g, '');
    const words = cleaned.split(/\s+/).filter(w => w.length >= 2);
    return words.length > 0 ? words[0] : '';
}

/**
 * 두 브랜드명이 유사한지 판단
 * 1) 정규화 키가 동일 (악센트/공백/특수문자 차이만 있는 경우)
 * 2) 한쪽이 다른 쪽의 부분문자열 (3자 이상)
 * 3) 첫 단어가 같고 4자 이상 (Tommy Hilfiger ↔ Tommy Jeans)
 */
function areBrandsSimilar(a, b) {
    const keyA = brandKey(a);
    const keyB = brandKey(b);

    // 1) 정규화 키 완전 일치
    if (keyA === keyB) return true;

    // 2) 부분문자열 매칭 (최소 3자)
    if (keyA.length >= 3 && keyB.length >= 3) {
        if (keyA.includes(keyB) || keyB.includes(keyA)) return true;
    }

    // 3) 첫 단어 매칭 (4자 이상의 첫 단어가 같으면 같은 브랜드 계열)
    const tokenA = firstToken(a);
    const tokenB = firstToken(b);
    if (tokenA.length >= 4 && tokenA === tokenB) return true;

    return false;
}

/**
 * DB에서 브랜드+수량을 가져와서 동적으로 그룹핑
 */
function refreshBrandCache() {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT brand, COUNT(*) as cnt FROM products 
             WHERE brand != '' AND brand != 'nan' AND brand IS NOT NULL
             AND LOWER(COALESCE(CAST(stock AS TEXT), '')) NOT LIKE '%sold%' 
             AND LOWER(COALESCE(CAST(stock AS TEXT), '')) NOT LIKE '%out%' 
             AND (arrival_date IS NULL OR arrival_date = '')
             GROUP BY brand ORDER BY cnt DESC`,
            [],
            (err, rows) => {
                if (err) {
                    if (err.message.includes('no such table')) {
                        console.log('[Brand Cache] Table "products" does not exist yet. Please sync.');
                        return resolve([]);
                    }
                    return reject(err);
                }

                // 1단계: 유사 브랜드들을 그룹으로 묶기
                // rows는 이미 cnt DESC로 정렬되어 있어서, 첫 번째 매칭이 대표 이름이 됨
                const groups = []; // [{ representative, members: [{name, cnt}], totalCnt }]

                for (const row of rows) {
                    const name = row.brand.trim();
                    if (!name) continue;

                    let foundGroup = null;
                    for (const group of groups) {
                        // 기존 그룹의 멤버들과 비교
                        for (const member of group.members) {
                            if (areBrandsSimilar(name, member.name)) {
                                foundGroup = group;
                                break;
                            }
                        }
                        if (foundGroup) break;
                    }

                    if (foundGroup) {
                        foundGroup.members.push({ name, cnt: row.cnt });
                        foundGroup.totalCnt += row.cnt;
                        // 대표 이름은 가장 많은 수량을 가진 원본 이름
                        const maxMember = foundGroup.members.reduce((a, b) => a.cnt > b.cnt ? a : b);
                        foundGroup.representative = maxMember.name;
                    } else {
                        groups.push({
                            representative: name,
                            members: [{ name, cnt: row.cnt }],
                            totalCnt: row.cnt
                        });
                    }
                }

                // 2단계: 캐시 구성
                const normalizedMap = {};
                const groupMap = {};

                for (const group of groups) {
                    const rep = group.representative;
                    const aliases = group.members.map(m => m.name.toLowerCase());
                    groupMap[rep] = aliases;
                    for (const member of group.members) {
                        normalizedMap[member.name.toLowerCase()] = rep;
                    }
                }

                // 상위 10개 (totalCnt 내림차순)
                groups.sort((a, b) => b.totalCnt - a.totalCnt);
                const topBrands = groups.slice(0, 10).map(g => g.representative);

                // 전체 리스트 (알파벳순)
                const allBrands = groups.map(g => g.representative).sort();

                brandCache = {
                    normalizedMap,
                    groupMap,
                    topBrands,
                    allBrands,
                    expiresAt: Date.now() + 10 * 60 * 1000 // 10분 캐시
                };

                console.log(`[Brand Cache] ${groups.length} groups, top: ${topBrands.join(', ')}`);
                resolve(brandCache);
            }
        );
    });
}

// 브랜드 캐시 반환 (만료 시 자동 갱신)
async function getBrandCache() {
    if (Date.now() > brandCache.expiresAt) {
        await refreshBrandCache();
    }
    return brandCache;
}

// 서버 시작 시 최초 캐시 빌드
db.serialize(() => {
    refreshBrandCache().catch(err => console.error('[Brand Cache] Init error:', err));
});

// GET /api/sync — manual migration from google sheets
// 특정 상품 실시간 동기화 API (개별 품절 대응용)
// [DEBUG ONLY] 서버의 파일 목록 확인 API
app.get('/api/debug/files', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    try {
        const rootFiles = fs.readdirSync(path.resolve(__dirname, '..', '..'));
        const serverFiles = fs.readdirSync(__dirname);
        res.json({ root: rootFiles, server: serverFiles, __dirname });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/debug/env', (req, res) => {
    const env = { ...process.env };
    if (env.GOOGLE_SERVICE_ACCOUNT) env.GOOGLE_SERVICE_ACCOUNT = 'HIDDEN';
    if (env.GOOGLE_PRIVATE_KEY) env.GOOGLE_PRIVATE_KEY = 'HIDDEN';
    res.json({
        cwd: process.cwd(),
        dirname: __dirname,
        env
    });
});

app.get('/api/debug/fs', (req, res) => {
    const { dir = '.' } = req.query;
    try {
        const targetPath = path.resolve(process.cwd(), dir);
        const stats = fs.statSync(targetPath);
        if (stats.isFile()) {
            const content = fs.readFileSync(targetPath, 'utf-8');
            return res.type('text/plain').send(content);
        }
        const files = fs.readdirSync(targetPath);
        const fileStats = files.map(f => {
            const p = path.join(targetPath, f);
            const s = fs.statSync(p);
            return {
                name: f,
                isDir: s.isDirectory(),
                size: s.size
            };
        });
        res.json({ path: targetPath, files: fileStats });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [DEBUG ONLY] 특정 상품의 DB 저장 상태 확인 API (배포 후 확인용)
app.get('/api/debug/product/:code', (req, res) => {
    const { code } = req.params;
    db.get('SELECT * FROM products WHERE code = ?', [code], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ product: row });
    });
});

const syncData = async () => {
    console.log('[Sync] Synchronization started');
    
    // 경로 유연하게 탐색
    const findScript = () => {
        const paths = [
            path.resolve(process.cwd(), 'catalog_app_v2', 'server', 'migrate_data.py'),
            path.resolve(process.cwd(), 'migrate_data.py'),
            path.resolve(__dirname, 'migrate_data.py')
        ];
        return paths.find(p => fs.existsSync(p)) || paths[0];
    };
    
    const scriptPath = findScript();
    const cmd = `python3 "${scriptPath}" || python "${scriptPath}"`;
    
    console.log(`[Sync] Running: ${cmd}`);
    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                console.error(`[Sync] Error: ${error.message}`);
                return reject({ error: error.message, details: stderr });
            }
            refreshBrandCache().catch(e => console.error('[Sync] Cache error:', e));
            resolve({ success: true, message: 'Sync completed', output: stdout });
        });
    });
};

// 10분마다 자동 동기화 (10 * 60 * 1000 ms)
const AUTO_SYNC_INTERVAL = 10 * 60 * 1000;
setInterval(async () => {
    console.log('[AutoSync] Triggering background sync...');
    try {
        const result = await syncData();
        console.log('[AutoSync] Success:', result.message);
    } catch (err) {
        console.error('[AutoSync] Failed:', err.error);
    }
}, AUTO_SYNC_INTERVAL);

app.get('/api/sync', async (req, res) => {
    try {
        const result = await syncData();
        // 할인 상품 정보도 함께 동기화
        await syncDiscountsFromSheets();
        // 동기화 시 방문자 통계도 함께 구글 시트에 백업
        await backupTrafficToSheets();
        res.json(result);
    } catch (err) {
        res.status(500).json(err);
    }
});

// [진단용] 배포 여부 확인
app.get('/api/deploy-check', (req, res) => {
    db.get('SELECT COUNT(*) as count FROM products', [], (err, row) => {
        res.json({ 
            version: 'FIXED-DB-PATH-V3',
            dbPath: dbPath,
            productCount: row ? row.count : 'ERROR',
            deployedAt: new Date().toISOString(),
            status: 'ok'
        });
    });
});

app.get('/api/debug-products-count', (req, res) => {
    db.get('SELECT COUNT(*) as count FROM products', [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row);
    });
});

app.get('/api/debug-search-product/:code', (req, res) => {
    const { code } = req.params;
    db.get('SELECT * FROM products WHERE code = ?', [code], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) {
            // Partial match search
            db.all('SELECT code, name FROM products WHERE code LIKE ? LIMIT 5', [`%${code}%`], (err2, rows) => {
                 res.json({ exact: null, partials: rows || [] });
            });
        } else {
            res.json({ exact: row });
        }
    });
});

app.post('/api/admin/sync-now', (req, res) => {
    const { exec } = require('child_process');
    const pythonCmd = process.env.VIRTUAL_ENV ? 'python' : 'python3';
    exec(`${pythonCmd} catalog_app_v2/server/migrate_data.py`, (err, stdout, stderr) => {
        res.json({
            success: !err,
            stdout,
            stderr,
            error: err ? err.message : null
        });
    });
});

app.get('/api/build-info', (req, res) => {
    try {
        const indexPath = path.join(CLIENT_DIST_PATH, 'index.html');
        const exists = fs.existsSync(indexPath);
        const stats = exists ? fs.statSync(indexPath) : null;
        
        res.json({
            distPath: CLIENT_DIST_PATH,
            indexExists: exists,
            buildTime: stats ? stats.mtime : null,
            cwd: process.cwd(),
            dirname: __dirname,
            files: fs.readdirSync(CLIENT_DIST_PATH).slice(0, 10)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [진단용] 동기화 로그 확인
app.get('/api/debug-sync-log', (req, res) => {
    try {
        const logPath = path.resolve(process.cwd(), 'db', 'sync_history.log');
        if (!fs.existsSync(logPath)) {
            return res.status(200).send(`Log file not found at: ${logPath}. (CWD: ${process.cwd()})`);
        }
        const logContent = fs.readFileSync(logPath, 'utf-8');
        res.type('text/plain').send(logContent || 'Log is empty');
    } catch (e) {
        res.status(500).send('Error reading log: ' + e.message);
    }
});

// GET /api/products
app.get('/api/products', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
        let { page = 1, limit = 25, brand, upper_category, category, season, search, sort, show_so = 'false', min_price, max_price, min_width, max_width, show_in_stock = 'false', show_scheduled = 'false', stock_status = 'all', arrival_date, isAdminPanel = 'false', style } = req.query;
        page = parseInt(page, 10);
        limit = parseInt(limit, 10);
        const offset = (page - 1) * limit;

        const cache = await getBrandCache();

        let query = `
            SELECT products.*, 
                   COALESCE(d.discount_rate, 0) as discount_rate,
                   (SELECT MAX(o.created_at) FROM orders o, json_each(o.items_json) item WHERE json_extract(item.value, '$.code') = products.code AND o.status IN ('confirmed', 'shipped', 'delivered')) as sold_at 
            FROM products 
            LEFT JOIN discount_products d ON products.code = d.product_code
            WHERE 1=1`;
        let whereClause = ''; // 전체 개수 쿼리용 WHERE절을 별도로 관리
        const params = [];

        // 재고 상태 필터 (stock_status: all, in_stock, sold_out)
        if (stock_status === 'in_stock') {
            const inStockFilter = ` AND LOWER(COALESCE(CAST(stock AS TEXT), '')) NOT LIKE '%sold%' AND LOWER(COALESCE(CAST(stock AS TEXT), '')) NOT LIKE '%out%'`;
            query += inStockFilter;
            whereClause += inStockFilter;
        } else if (stock_status === 'sold_out') {
            const soldOutFilter = ` AND (LOWER(COALESCE(CAST(stock AS TEXT), '')) LIKE '%sold%' OR LOWER(COALESCE(CAST(stock AS TEXT), '')) LIKE '%out%')`;
            query += soldOutFilter;
            whereClause += soldOutFilter;
        } else if (show_so === 'false') {
            // 기존 show_so 호환용
            const soldOutFilter = ` AND LOWER(COALESCE(CAST(stock AS TEXT), '')) NOT LIKE '%sold%' AND LOWER(COALESCE(CAST(stock AS TEXT), '')) NOT LIKE '%out%'`;
            query += soldOutFilter;
            whereClause += soldOutFilter;
        }

        // 브랜드 필터 - 쉼표로 구분된 여러 브랜드 지원 및 정규화된 그룹의 모든 alias로 검색
        if (brand && brand !== 'All') {
            let brandStr = Array.isArray(brand) ? brand.join(',') : brand;
            const brandList = brandStr.split(',').map(b => b.trim()).filter(b => b);
            const allAliases = [];
            brandList.forEach(b => {
                const aliases = cache.groupMap[b];
                if (aliases && aliases.length > 0) {
                    aliases.forEach(a => { if (a) allAliases.push(a); });
                } else {
                    allAliases.push(b);
                }
            });
            
            if (allAliases.length > 0) {
                const placeholders = allAliases.map(() => '?').join(', ');
                const brandFilter = ` AND LOWER(TRIM(products.brand)) IN (${placeholders})`;
                query += brandFilter;
                whereClause += brandFilter;
                allAliases.forEach(a => params.push(String(a).toLowerCase().trim()));
            }
        }

        // 상위카테고리 필터 (E열)
        if (upper_category && upper_category !== 'All') {
            const upperList = upper_category.split(',').map(c => c.trim()).filter(c => c);
            if (upperList.length > 0) {
                const placeholders = upperList.map(() => '?').join(', ');
                query += ` AND upper_category IN (${placeholders})`;
                whereClause += ` AND upper_category IN (${placeholders})`;
                upperList.forEach(c => params.push(c));
            }
        }

        // 하위카테고리 필터 (F열)
        if (category && category !== 'All') {
            if (category === '822 Archive') {
                query += ` AND LOWER(u) LIKE '%rare%'`;
                whereClause += ` AND LOWER(u) LIKE '%rare%'`;
            } else if (category === 'Accessory') {
                query += ` AND upper_category IN ('액세서리', '모자')`;
                whereClause += ` AND upper_category IN ('액세서리', '모자')`;
                whereClause += ` AND upper_category NOT IN ('Tops', 'Outerwear', 'Bottoms', '상의', '아우터', '하의', '원피스') AND category != 'Dress' AND LOWER(category) NOT LIKE '%dress%'`;
            } else if (category === 'Winter') {
                query += ` AND u LIKE '%Winter%'`;
                whereClause += ` AND u LIKE '%Winter%'`;
            } else {
                const catList = category.split(',').map(c => c.trim()).filter(c => c);
                if (catList.length > 0) {
                    const placeholders = catList.map(() => '?').join(', ');
                    query += ` AND category IN (${placeholders})`;
                    whereClause += ` AND category IN (${placeholders})`;
                    catList.forEach(c => params.push(c));
                }
            }
        }

        // 스타일 필터 (Y열)
        if (style && style !== 'All') {
            const stylesList = style.split(',').map(s => s.trim()).filter(s => s);
            if (stylesList.length > 0) {
                const styleConditions = stylesList.map(() => `style LIKE ?`).join(' OR ');
                query += ` AND (${styleConditions})`;
                whereClause += ` AND (${styleConditions})`;
                stylesList.forEach(s => params.push(`%${s}%`));
            }
        }

        if (search) {
            query += ` AND (name LIKE ? OR code LIKE ?)`;
            whereClause += ` AND (name LIKE ? OR code LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`);
        }

        // In-Stock 제품만 보기 필터: 가격이 있고, 품절이 아닌 상품
        if (show_in_stock === 'true') {
            const inStockFilter = ` AND price != 'TBD' AND price != '' AND price IS NOT NULL 
                                    AND LOWER(COALESCE(CAST(stock AS TEXT), '')) NOT LIKE '%sold%' 
                                    AND LOWER(COALESCE(CAST(stock AS TEXT), '')) NOT LIKE '%out%'`;
            query += inStockFilter;
            whereClause += inStockFilter;
        }

        // 도착예정상품 필터
        if (show_scheduled === 'true') {
            query += ` AND arrival_date IS NOT NULL AND arrival_date != ''`;
            whereClause += ` AND arrival_date IS NOT NULL AND arrival_date != ''`;
        } else if (isAdminPanel !== 'true' && !arrival_date) {
            // 관리자 모드가 아니고 특정 도착일 필터가 아닐 경우, 일반 상품 목록에서는 도착예정 상품을 아예 배제
            query += ` AND (arrival_date IS NULL OR arrival_date = '')`;
            whereClause += ` AND (arrival_date IS NULL OR arrival_date = '')`;
        }

        // 특정 도착 예정일 필터
        if (arrival_date) {
            query += ` AND arrival_date = ?`;
            whereClause += ` AND arrival_date = ?`;
            params.push(arrival_date);
        }

        // 가격 범위 필터
        if (min_price && !isNaN(parseInt(min_price))) {
            query += ` AND price != 'TBD' AND CAST(price AS INTEGER) >= ?`;
            whereClause += ` AND price != 'TBD' AND CAST(price AS INTEGER) >= ?`;
            params.push(parseInt(min_price));
        }
        if (max_price && !isNaN(parseInt(max_price))) {
            query += ` AND price != 'TBD' AND CAST(price AS INTEGER) <= ?`;
            whereClause += ` AND price != 'TBD' AND CAST(price AS INTEGER) <= ?`;
            params.push(parseInt(max_price));
        }

        // 가슴단면(Width) 필터: actual_size 포맷이 'width,length' 형태인 경우 추출
        if (min_width || max_width) {
            const widthExpr = `CAST(CASE WHEN INSTR(actual_size, ',') > 0 THEN SUBSTR(actual_size, 1, INSTR(actual_size, ',') - 1) ELSE actual_size END AS REAL)`;
            const sizeCondition = `actual_size IS NOT NULL AND actual_size != ''`;

            if (min_width && !isNaN(parseFloat(min_width))) {
                query += ` AND ${sizeCondition} AND ${widthExpr} >= ?`;
                whereClause += ` AND ${sizeCondition} AND ${widthExpr} >= ?`;
                params.push(parseFloat(min_width));
            }
            if (max_width && !isNaN(parseFloat(max_width))) {
                query += ` AND ${sizeCondition} AND ${widthExpr} <= ?`;
                whereClause += ` AND ${sizeCondition} AND ${widthExpr} <= ?`;
                params.push(parseFloat(max_width));
            }
        }


        // 정렬
        // 가격이 오직 숫자, 콤마(,) 마침표(.)로만 구성된 경우에만 우선순위 부여 (텍스트 포함 제외)
        const pricePriority = "CASE WHEN (price != '' AND price IS NOT NULL AND price NOT GLOB '*[^0-9,.]*') THEN 0 ELSE 1 END";
        
        if (sort === '1') { // 가격 낮은 순
            query += ` ORDER BY ${pricePriority} ASC, CAST(REPLACE(price, ',', '') AS INTEGER) ASC`;
        } else if (sort === '2') { // 가격 높은 순
            query += ` ORDER BY ${pricePriority} ASC, CAST(REPLACE(price, ',', '') AS INTEGER) DESC`;
        } else { // 최신순 (기본)
            if (stock_status === 'sold_out') {
                query += ` ORDER BY sold_at DESC, ${pricePriority} ASC, products.rowid DESC`;
            } else {
                query += ` ORDER BY 
                            -- 1순위: 판매가 정보 유무 (M열)
                            CASE WHEN (price != 'TBD' AND price != '' AND price IS NOT NULL) THEN 0 ELSE 1 END ASC,
                            -- 2순위: (판매가 없는 경우) 예상도착일 유형 (R열)
                            CASE 
                                WHEN (price = 'TBD' OR price = '' OR price IS NULL) AND (arrival_date IS NOT NULL AND arrival_date != '' AND LOWER(arrival_date) != 'tbd') THEN 0
                                WHEN (price = 'TBD' OR price = '' OR price IS NULL) AND LOWER(arrival_date) = 'tbd' THEN 1
                                ELSE 2 
                            END ASC,
                            -- 그룹 내 상세 정렬
                            CASE 
                                -- 판매가 있는 제품: 최신 업로드 순
                                WHEN (price != 'TBD' AND price != '' AND price IS NOT NULL) THEN products.rowid
                                ELSE 0
                            END DESC,
                            -- 날짜가 있는 제품: 날짜순
                            CASE 
                                WHEN (arrival_date IS NOT NULL AND arrival_date != '' AND LOWER(arrival_date) != 'tbd') THEN 
                                    CAST(SUBSTR(arrival_date, 1, INSTR(arrival_date, '/') - 1) AS INTEGER) * 100 + CAST(SUBSTR(arrival_date, INSTR(arrival_date, '/') + 1) AS INTEGER) 
                                ELSE 999999 
                            END ASC,
                            -- 최종 보조 정렬 (최신순)
                            products.rowid DESC`;
            }
        }

        query += ` LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        // 전체 개수 쿼리 (별도로 관리한 whereClause 사용 - ORDER BY 분리 방식 제거)
        let countQuery = `SELECT COUNT(*) as total FROM products WHERE 1=1${whereClause}`;
        const countParams = params.slice(0, params.length - 2); // LIMIT, OFFSET 제외

        db.get(countQuery, countParams, (err, countRow) => {
            if (err) {
                if (err.message.includes('no such table')) {
                    return res.json({ data: [], total: 0, page, totalPages: 0 });
                }
                return res.status(500).json({ error: err.message });
            }
            db.all(query, params, (err, rows) => {
                if (err) {
                    if (err.message.includes('no such table')) {
                        return res.json({ data: [], total: 0, page, totalPages: 0 });
                    }
                    return res.status(500).json({ error: err.message });
                }
                res.json({
                    data: rows,
                    total: countRow.total,
                    page,
                    totalPages: Math.ceil(countRow.total / limit)
                });
            });
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/products/:code
// 왜 로컬 파일을 직접 탐색하는가:
// - 1394번 이후 상품은 static/images/{code}/ 폴더에 원본 6장이 저장됨
// - 1671번 이후 상품은 추가로 main{code}.jpg (누끼/배경제거) 이미지가 존재
// - 1393번 이하 초기 상품은 Composites 합성 사진 1장만 존재
// - DB에 저장된 product_images보다 로컬 파일 기반이 더 정확하고 최신 상태를 반영
app.get('/api/products/:code', (req, res) => {
    const { code } = req.params;
    db.get(`
        SELECT p.*, IFNULL(d.discount_rate, 0) as discount_rate
        FROM products p
        LEFT JOIN discount_products d ON p.code = d.product_code
        WHERE p.code = ?
    `, [code], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Product not found' });

        // ─── 로컬 이미지 폴더 탐색 (DB 데이터보다 우선) ───
        const productImgDir = path.join(STATIC_ASSETS_PATH, 'images', code);
        const compositePath = path.join(STATIC_ASSETS_PATH, 'images', 'Composites', `${code}.jpg`);

        try {
            if (fs.existsSync(productImgDir) && fs.statSync(productImgDir).isDirectory()) {
                // [Case A] 개별 이미지 폴더 존재 (1394번 이후 상품)
                const files = fs.readdirSync(productImgDir);

                // 1) 누끼 이미지 탐색: main{code}.jpg 패턴 (1671번 이후에만 존재)
                const nukkiFile = files.find(f => 
                    f.toLowerCase() === `main${code}.jpg`.toLowerCase()
                );
                if (nukkiFile) {
                    row.nukki_url = `/static/images/${code}/${nukkiFile}`;
                }
                // 누끼 파일이 없으면 기존 DB의 nukki_url 유지 (빈 문자열일 수 있음)

                // 2) 원본 이미지 탐색: 1.JPG ~ 6.JPG (대소문자 무관)
                const numberedImages = [];
                for (let i = 1; i <= 6; i++) {
                    const found = files.find(f => 
                        f.toLowerCase() === `${i}.jpg` || f.toLowerCase() === `${i}.jpeg` || f.toLowerCase() === `${i}.png`
                    );
                    if (found) {
                        numberedImages.push(`/static/images/${code}/${found}`);
                    }
                }

                // 원본 이미지가 1장이라도 있으면 DB 데이터를 대체
                if (numberedImages.length > 0) {
                    row.product_images = numberedImages;
                } else {
                    // 폴더는 있지만 번호 파일이 없는 예외 상황 → DB 폴백
                    try {
                        if (row.product_images && row.product_images.trim()) {
                            row.product_images = JSON.parse(row.product_images);
                        } else {
                            row.product_images = row.image_url ? [row.image_url] : [];
                        }
                    } catch (e) {
                        row.product_images = row.image_url ? [row.image_url] : [];
                    }
                }
            } else if (fs.existsSync(compositePath)) {
                // [Case B] Composites 합성 사진만 존재 (1393번 이하 초기 상품)
                row.product_images = [`/static/images/Composites/${code}.jpg`];
            } else {
                // [Case C] 로컬 이미지 없음 → DB의 product_images 그대로 사용
                try {
                    if (row.product_images && row.product_images.trim()) {
                        row.product_images = JSON.parse(row.product_images);
                    } else {
                        row.product_images = row.image_url ? [row.image_url] : [];
                    }
                } catch (e) {
                    row.product_images = row.image_url ? [row.image_url] : [];
                }
            }
        } catch (fsError) {
            // 파일 시스템 오류 시 안전하게 DB 폴백
            console.error(`[Detail] 이미지 폴더 탐색 오류 (code=${code}):`, fsError.message);
            try {
                if (row.product_images && typeof row.product_images === 'string' && row.product_images.trim()) {
                    row.product_images = JSON.parse(row.product_images);
                } else {
                    row.product_images = row.image_url ? [row.image_url] : [];
                }
            } catch (e) {
                row.product_images = row.image_url ? [row.image_url] : [];
            }
        }

        res.json(row);
    });
});


// GET /api/filters — 브랜드(정규화), 상위카테고리(제품수 DESC), 하위카테고리, 가격 범위
app.get('/api/filters', async (req, res) => {
    try {
        const cache = await getBrandCache();

        // 상위카테고리: 제품 수 많은 순서로 정렬
        const upperCategories = await new Promise((resolve, reject) =>
            db.all(
                `SELECT upper_category, COUNT(*) as cnt FROM products 
                 WHERE upper_category != '' AND upper_category != 'nan' 
                 GROUP BY upper_category ORDER BY cnt DESC`,
                [],
                (err, rows) => {
                    if (err) {
                        if (err.message.includes('no such table')) return resolve([]);
                        return reject(err);
                    }
                    resolve(rows.map(r => r.upper_category));
                }
            )
        );

        // 하위카테고리 (알파벳순)
        const categories = await new Promise((resolve, reject) =>
            db.all(
                `SELECT DISTINCT category FROM products WHERE category != '' AND category != 'nan' ORDER BY category`,
                [],
                (err, rows) => {
                    if (err) {
                        if (err.message.includes('no such table')) return resolve([]);
                        return reject(err);
                    }
                    resolve(rows.map(r => r.category));
                }
            )
        );

        // 카테고리 매핑 (상위카테고리 -> 하위카테고리 목록)
        const categoryMap = await new Promise((resolve, reject) =>
            db.all(
                `SELECT DISTINCT upper_category, category FROM products 
                 WHERE category != '' AND category != 'nan' 
                 AND upper_category != '' AND upper_category != 'nan'
                 ORDER BY upper_category, category`,
                [],
                (err, rows) => {
                    if (err) {
                        if (err.message.includes('no such table')) return resolve({});
                        return reject(err);
                    }
                    const map = {};
                    rows.forEach(r => {
                        if (!map[r.upper_category]) map[r.upper_category] = [];
                        map[r.upper_category].push(r.category);
                    });
                    resolve(map);
                }
            )
        );

        // 가격 범위 (TBD 제외)
        const priceRange = await new Promise((resolve, reject) =>
            db.get(
                `SELECT MIN(CAST(price AS INTEGER)) as minPrice, MAX(CAST(price AS INTEGER)) as maxPrice 
                 FROM products WHERE price != 'TBD' AND price != '' AND price != 'nan'`,
                [],
                (err, row) => {
                    if (err) {
                        if (err.message.includes('no such table')) return resolve({ min: 0, max: 100000 });
                        return reject(err);
                    }
                    resolve({ min: row?.minPrice || 0, max: row?.maxPrice || 100000 });
                }
            )
        );

        // 가슴단면(width) 범위 (actual_size: 'width,length' 형식에서 추출)
        const widthRange = await new Promise((resolve, reject) =>
            db.get(
                `SELECT MIN(CAST(CASE WHEN INSTR(actual_size, ',') > 0 THEN SUBSTR(actual_size, 1, INSTR(actual_size, ',') - 1) ELSE actual_size END AS REAL)) as minWidth, 
                        MAX(CAST(CASE WHEN INSTR(actual_size, ',') > 0 THEN SUBSTR(actual_size, 1, INSTR(actual_size, ',') - 1) ELSE actual_size END AS REAL)) as maxWidth 
                 FROM products 
                 WHERE actual_size IS NOT NULL AND actual_size != ''`,
                [],
                (err, row) => {
                    if (err) {
                        return resolve({ min: 0, max: 100 });
                    }
                    resolve({ 
                        min: row?.minWidth ? Math.floor(row.minWidth) : 0, 
                        max: row?.maxWidth ? Math.ceil(row.maxWidth) : 100 
                    });
                }
            )
        );

        // 도착 예정일 목록 (알파벳/날짜순 정렬)
        const arrivalDates = await new Promise((resolve, reject) =>
            db.all(
                `SELECT DISTINCT arrival_date FROM products 
                 WHERE arrival_date != '' AND arrival_date != 'nan' AND arrival_date IS NOT NULL 
                 ORDER BY arrival_date ASC`,
                [],
                (err, rows) => {
                    if (err) return resolve([]);
                    resolve(rows.map(r => r.arrival_date));
                }
            )
        );

        res.json({
            brands: cache.allBrands,
            topBrands: cache.topBrands,
            upperCategories,
            categories,
            categoryMap,
            priceRange,
            widthRange,
            arrivalDates
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/shipping — DB의 arrival_date 컬럼에서 고유 도착 예정일 조회
// '사입품목' 시트의 예상도착일(R열)이 마이그레이션 시 arrival_date로 저장됨
app.get('/api/shipping', (req, res) => {
    db.all(
        `SELECT DISTINCT arrival_date FROM products
         WHERE arrival_date != '' AND arrival_date != 'nan' AND arrival_date IS NOT NULL
         ORDER BY arrival_date ASC`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            const arrivalDates = rows.map(r => r.arrival_date);
            res.json({ arrivalDates });
        }
    );
});

// GET /api/notices — reads from Google Sheets '공지사항' tab (5-min cache)
app.get('/api/notices', async (req, res) => {
    try {
        const notices = await fetchNoticesFromSheets();
        res.json(notices);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================
// 회원가입 API
// POST /api/register — 새 고객 등록
// 라인 ID 중복 체크 후 SQLite 저장 + Google Sheets 동기화
// =============================================
app.post('/api/register', async (req, res) => {
    try {
        const { login_id, password, name, line_id, phone, province, district, sub_district, postal_code, address_detail } = req.body;

        // 필수 필드 및 형식 검증 (line_id 제외)
        if (!login_id || !password || !name || !phone || !province || !district || !sub_district || !postal_code || !address_detail) {
            return res.status(400).json({ error: 'MISSING_FIELDS', message: 'All fields except line_id are required.' });
        }

        // 아이디 규칙: 영어/숫자 4~20자
        const idRegex = /^[a-zA-Z0-9]{4,20}$/;
        if (!idRegex.test(login_id)) {
            return res.status(400).json({ error: 'INVALID_ID', message: 'ID must be 4-20 alphanumeric characters.' });
        }

        // 비밀번호 규칙: 영어+숫자 포함 8자 이상 (특수문자 허용)
        const pwRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
        if (!pwRegex.test(password)) {
            return res.status(400).json({ error: 'INVALID_PASSWORD', message: 'Password must be 8+ chars with letters and numbers.' });
        }

        const cleanLoginId = login_id.trim().toLowerCase();
        // line_id가 없을 경우 고정값('-') 대신 login_id를 활용해 UNIQUE 제약 에러 방지
        const cleanLineId = line_id && line_id.trim() ? line_id.trim() : `-${cleanLoginId}`;

        // 비밀번호 해싱
        const hashedPassword = await bcrypt.hash(password, 10);

        // SQLite에 저장
        const insertSQL = `
            INSERT INTO customers (login_id, password, name, line_id, phone, province, district, sub_district, postal_code, address_detail)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        db.run(insertSQL, [cleanLoginId, hashedPassword, name.trim(), cleanLineId, phone.trim(), province, district, sub_district, postal_code, address_detail.trim()], async function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    if (err.message.includes('login_id')) {
                        return res.status(409).json({ error: 'DUPLICATE_LOGIN_ID', message: 'This ID is already taken.' });
                    }
                    if (err.message.includes('line_id')) {
                        return res.status(409).json({ error: 'DUPLICATE_LINE_ID', message: 'This Line ID is already registered.' });
                    }
                }
                console.error('[Register] DB error:', err.message);
                return res.status(500).json({ error: 'DB_ERROR', message: 'Registration failed.' });
            }

            const customerId = this.lastID;
            const createdAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
            console.log(`[Register] New customer #${customerId}: ${cleanLoginId}`);

            // Google Sheets 동기화 (login_id 포함)
            try {
                const auth = await getGoogleSheetsWriteAuth();
                const sheets = google.sheets({ version: 'v4', auth });
                // 기존 관리자 양식(A:이름, B:전화번호, C:전체주소, D:가입일)으로 통일
                // 이름 형식: 아이디(이름) 또는 라인아이디(아이디,이름)
                const isDummyLineId = cleanLineId.startsWith('-');
                const formattedName = !isDummyLineId ? `${cleanLineId}(${cleanLoginId}, ${name.trim()})` : `(${cleanLoginId}, ${name.trim()})`;
                const fullAddress = [address_detail.trim(), sub_district, district, province, postal_code].filter(Boolean).join(', ');
                await sheets.spreadsheets.values.append({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${CUSTOMERS_SHEET}!A:D`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: {
                        values: [[formattedName, phone.trim(), fullAddress, createdAt]]
                    }
                });
            } catch (sheetsErr) {
                console.error('[Register] Sheets sync error:', sheetsErr.message);
            }

            res.status(201).json({ success: true, customerId });
        });
    } catch (err) {
        console.error('[Register] Unexpected error:', err.message);
        res.status(500).json({ error: 'SERVER_ERROR', message: 'An unexpected error occurred.' });
    }
});

app.post('/api/login', (req, res) => {
    const { login_id, password } = req.body;

    if (!login_id || !password) {
        return res.status(400).json({ error: 'MISSING_FIELDS', message: 'ID and password are required.' });
    }

    db.get(`SELECT * FROM customers WHERE LOWER(login_id) = ?`, [login_id.trim().toLowerCase()], async (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'NOT_FOUND', message: 'Account not found.' });

        try {
            // 비밀번호 대조
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Incorrect password.' });
            }

            // 보안상 비밀번호 제거 후 반환
            const { password: _, ...userInfo } = user;
            res.json({ success: true, user: userInfo });
        } catch (bcryptErr) {
            res.status(500).json({ error: 'SERVER_ERROR', message: bcryptErr.message });
        }
    });
});

// GET /api/check-line-id/:lineId — 라인 ID 중복 확인
app.get('/api/check-line-id/:lineId', (req, res) => {
    const { lineId } = req.params;
    db.get('SELECT id FROM customers WHERE line_id = ?', [lineId.trim()], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ exists: !!row });
    });
});

// GET /api/check-login-id/:loginId — 아이디 중복 확인
app.get('/api/check-login-id/:loginId', (req, res) => {
    const { loginId } = req.params;
    db.get('SELECT id FROM customers WHERE LOWER(login_id) = ?', [loginId.trim().toLowerCase()], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ exists: !!row });
    });
});



// =============================================
// 장바구니 API
// =============================================

// GET /api/cart/:customerId — 장바구니 조회 (상품 정보 JOIN)
app.get('/api/cart/:customerId', (req, res) => {
    const { customerId } = req.params;
    db.all(
        `SELECT c.id, c.product_code, c.quantity, c.added_at,
                p.name, p.brand, p.price, p.thumbnail_url, p.image_url, p.stock, p.size
         FROM cart c
         LEFT JOIN products p ON c.product_code = p.code
         WHERE c.customer_id = ?
         ORDER BY c.added_at DESC`,
        [customerId],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ items: rows || [] });
        }
    );
});

// POST /api/cart — 장바구니에 상품 추가 (1개만 허용, 중복 차단)
app.post('/api/cart', (req, res) => {
    const { customer_id, product_code } = req.body;

    if (!customer_id || !product_code) {
        return res.status(400).json({ error: 'MISSING_FIELDS' });
    }

    // 이미 담긴 상품은 추가하지 않음 (상품당 1개만 존재)
    db.run(
        `INSERT OR IGNORE INTO cart (customer_id, product_code, quantity) VALUES (?, ?, 1)`,
        [customer_id, product_code],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) {
                return res.status(409).json({ error: 'ALREADY_IN_CART', message: 'This item is already in your cart.' });
            }
            console.log(`[Cart] Customer #${customer_id} added ${product_code}`);
            res.json({ success: true, cartItemId: this.lastID });
        }
    );
});

// (수량 선택 기능 제거됨 - 상품당 1개만 존재)

// DELETE /api/cart/:customerId/:productCode — 장바구니 항목 삭제
app.delete('/api/cart/:customerId/:productCode', (req, res) => {
    const { customerId, productCode } = req.params;
    db.run('DELETE FROM cart WHERE customer_id = ? AND product_code = ?',
        [customerId, productCode],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, deleted: this.changes > 0 });
        }
    );
});

// =============================================
// 주문 API
// 주문 생성 시 장바구니 → 주문으로 변환 + Google Sheets 동기화
// =============================================

// 주문번호 생성 (822-YYYYMMDD-XXXX 형식)
async function generateOrderNumber() {
    const now = new Date();
    // 태국 시간(UTC+7) 고려하여 날짜 문자열 생성 (YYYYMMDD)
    const offset = 7 * 60 * 60 * 1000;
    const thaiDate = new Date(now.getTime() + offset);
    
    const dateStr = thaiDate.getUTCFullYear().toString() +
        String(thaiDate.getUTCMonth() + 1).padStart(2, '0') +
        String(thaiDate.getUTCDate()).padStart(2, '0');
    
    const prefix = `822-${dateStr}-`;
    
    return new Promise((resolve, reject) => {
        // 해당 날짜로 시작하는 주문번호 중 가장 큰 번호를 찾음
        db.get(
            `SELECT MAX(order_number) as lastOrder FROM orders WHERE order_number LIKE ?`,
            [prefix + '%'],
            (err, row) => {
                if (err) return reject(err);
                
                let nextNum = 1;
                if (row && row.lastOrder) {
                    const parts = row.lastOrder.split('-');
                    if (parts.length === 3) {
                        const lastNum = parseInt(parts[2], 10);
                        if (!isNaN(lastNum)) {
                            nextNum = lastNum + 1;
                        }
                    }
                }
                
                // 3자리 순차 번호 (001, 002...)
                const sequence = String(nextNum).padStart(3, '0');
                resolve(`${prefix}${sequence}`);
            }
        );
    });
}

/**
 * [Order] 배송비 자동 계산 로직
 * 조건: 합계 1,000바트 이상 OR 수량 2개 이상 구매 시 무료 (기본 40바트)
 */
function calculateShippingFee(items) {
    const productItems = items.filter(it => it.code !== 'SHIPPING_FEE' && it.code !== 'COUPON_DISCOUNT');
    const totalQuantity = productItems.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
    const subtotal = productItems.reduce((sum, it) => sum + (Number(it.subtotal) || 0), 0);
    
    if (totalQuantity === 0) return 0;
    if (subtotal >= 1000 || totalQuantity >= 2) return 0;
    return 40;
}

/**
 * [Order] 주문의 배송비 아이템을 동기화하고 합계를 업데이트함
 */
async function syncShippingFee(orderNumber) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM orders WHERE order_number = ?', [orderNumber], (err, order) => {
            if (err || !order) return reject(err || new Error('Order not found'));

            let items = JSON.parse(order.items_json || '[]');

            const fee = calculateShippingFee(items);

            // 기존 배송비 제거 후 필요시 재삽입 (항상 리스트 하단 유지)
            items = items.filter(it => it.code !== 'SHIPPING_FEE');
            if (fee > 0) {
                items.push({
                    code: 'SHIPPING_FEE',
                    name: 'Shipping Fee',
                    brand: '-',
                    price: fee,
                    quantity: 1,
                    subtotal: fee,
                    paid: ['confirmed', 'shipped', 'delivered'].includes(order.status)
                });
            }

            // 총매출액(total_amount)은 배송비를 제외한 상품들의 합계로 계산 (사용자 요청)
            const totalAmount = items
                .filter(it => it.code !== 'SHIPPING_FEE')
                .reduce((sum, i) => sum + (Number(i.subtotal) || 0), 0);

            db.run(
                'UPDATE orders SET items_json = ?, total_amount = ? WHERE order_number = ?',
                [JSON.stringify(items), totalAmount, orderNumber],
                (err2) => {
                    if (err2) return reject(err2);
                    resolve({ items, totalAmount });
                }
            );
        });
    });
}

// POST /api/orders — 주문 생성
app.post('/api/orders', async (req, res) => {
    try {
        const { customer_id, coupon_code, coupon_target_product } = req.body;

        if (!customer_id) {
            return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Customer ID is required.' });
        }

        // 1) 고객 정보 조회
        const customer = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM customers WHERE id = ?', [customer_id], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });

        if (!customer) {
            return res.status(404).json({ error: 'NOT_FOUND', message: 'Customer not found.' });
        }

        // 2) 장바구니 조회 (상품 정보 JOIN - stock 추가)
        const cartItems = await new Promise((resolve, reject) => {
            db.all(
                `SELECT c.product_code, c.quantity,
                        p.name, p.brand, p.price, p.thumbnail_url, p.image_url, p.stock
                 FROM cart c
                 LEFT JOIN products p ON c.product_code = p.code
                 WHERE c.customer_id = ?`,
                [customer_id],
                (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows || []);
                }
            );
        });

        if (cartItems.length === 0) {
            return res.status(400).json({ error: 'EMPTY_CART', message: 'Cart is empty.' });
        }

        // [New] 쿠폰 검증
        let validCoupon = null;
        if (coupon_code) {
            validCoupon = await new Promise((resolve, reject) => {
                db.get(`SELECT * FROM coupons WHERE code = ? AND is_used = 0`, [coupon_code.trim().toUpperCase()], (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                });
            });
            if (!validCoupon) {
                return res.status(400).json({ error: 'INVALID_COUPON', message: '유효하지 않거나 이미 사용된 쿠폰입니다.' });
            }
            const today = new Date().toISOString().split('T')[0];
            if (validCoupon.expires_at < today) {
                return res.status(400).json({ error: 'EXPIRED_COUPON', message: '만료된 쿠폰입니다.' });
            }
        }

        // 3) 주문 데이터 준비 및 구매예약 상품 여부 판별
        const hasPreorderItem = cartItems.some(item => {
            const priceStr = String(item.price || '').trim().toUpperCase();
            const stockStr = String(item.stock || '').trim().toLowerCase();
            const isSoldOrOut = stockStr.includes('sold') || stockStr.includes('out');
            const isOnSale = stockStr.replace(/\s+/g, '') === 'onsale';
            return priceStr === 'TBD' || (!isOnSale && !isSoldOrOut);
        });

        const orderStatus = hasPreorderItem ? 'preorder_pending' : 'pending';

        let items = cartItems.map(item => {
            const priceStr = String(item.price || '').trim().toUpperCase();
            const stockStr = String(item.stock || '').trim().toLowerCase();
            const isSoldOrOut = stockStr.includes('sold') || stockStr.includes('out');
            const isOnSale = stockStr.replace(/\s+/g, '') === 'onsale';
            const isPreorder = priceStr === 'TBD' || (!isOnSale && !isSoldOrOut);

            return {
                code: item.product_code,
                name: item.name || 'Unknown',
                brand: item.brand || '',
                thumbnail_url: item.thumbnail_url || item.image_url || null,
                price: priceStr === 'TBD' ? 0 : (Number(item.price) || 0),
                quantity: item.quantity,
                subtotal: priceStr === 'TBD' ? 0 : ((Number(item.price) || 0) * item.quantity),
                is_preorder: isPreorder
            };
        });

        // [New] 배송비 자동 계산 (항상 40바트 기준, 조건 충족 시 무료)
        // 단, 예약 주문이 아닌 경우에만 정상 배송비를 매기거나 예약 주문이라도 상품 개수가 있는 경우 계산
        // [New] 쿠폰 할인 적용
        if (validCoupon) {
            let discountAmount = 0;
            if (validCoupon.type === 'amount') {
                discountAmount = validCoupon.value;
                const itemsSubtotal = items.reduce((sum, i) => sum + i.subtotal, 0);
                if (discountAmount > itemsSubtotal) discountAmount = itemsSubtotal;
            } else if (validCoupon.type === 'rate') {
                const targetItem = items.find(it => it.code === coupon_target_product);
                if (targetItem) {
                    discountAmount = Math.floor(targetItem.subtotal * (validCoupon.value / 100));
                }
            }

            if (discountAmount > 0) {
                items.push({
                    code: 'COUPON_DISCOUNT',
                    name: '쿠폰 할인 (' + validCoupon.code + ')',
                    brand: '-',
                    price: -discountAmount,
                    quantity: 1,
                    subtotal: -discountAmount,
                    paid: false
                });
            }
        }

        const fee = calculateShippingFee(items);
        if (fee > 0) {
            items.push({
                code: 'SHIPPING_FEE',
                name: 'Shipping Fee',
                brand: '-',
                price: fee,
                quantity: 1,
                subtotal: fee,
                paid: false
            });
        }

        // 총매출액은 상품 합계만 포함 (배송비 제외)
        const totalAmount = items
            .filter(it => it.code !== 'SHIPPING_FEE')
            .reduce((sum, i) => sum + i.subtotal, 0);
        const shippingAddress = `${customer.address_detail}, ${customer.sub_district}, ${customer.district}, ${customer.province} ${customer.postal_code}`;

        // YYYY-MM-DD 태국 기준 오늘 날짜 구하기
        const bangkokTime = new Date(Date.now() + 7 * 60 * 60 * 1000);
        const todayDateStr = bangkokTime.toISOString().split('T')[0];

        // 4) 오늘 날짜에 동일 고객의 동일 유형 미처리 주문서(pending 또는 preorder_pending)가 있는지 조회
        const existingOrder = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM orders 
                 WHERE customer_id = ? 
                   AND status = ? 
                   AND substr(created_at, 1, 10) = ?`,
                [customer_id, orderStatus, todayDateStr],
                (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                }
            );
        });

        let orderNumber;
        let isMerged = false;

        if (existingOrder) {
            // 기존 주문서가 존재하는 경우 병합
            isMerged = true;
            orderNumber = existingOrder.order_number;
            
            let mergedItems = JSON.parse(existingOrder.items_json || '[]');
            // 기존 배송비 임시 제거
            mergedItems = mergedItems.filter(it => it.code !== 'SHIPPING_FEE');

            // 이번 장바구니 상품들 병합 (배송비 제외)
            const newProductsOnly = items.filter(it => it.code !== 'SHIPPING_FEE');
            newProductsOnly.forEach(newItem => {
                const matchedIdx = mergedItems.findIndex(it => it.code === newItem.code);
                if (matchedIdx > -1) {
                    mergedItems[matchedIdx].quantity += newItem.quantity;
                    mergedItems[matchedIdx].subtotal += newItem.subtotal;
                } else {
                    mergedItems.push(newItem);
                }
            });

            // 배송비 재계산 후 적용
            const newFee = calculateShippingFee(mergedItems);
            if (newFee > 0) {
                mergedItems.push({
                    code: 'SHIPPING_FEE',
                    name: 'Shipping Fee',
                    brand: '-',
                    price: newFee,
                    quantity: 1,
                    subtotal: newFee,
                    paid: false
                });
            }

            // 총합 계산
            const newTotalAmount = mergedItems
                .filter(it => it.code !== 'SHIPPING_FEE')
                .reduce((sum, i) => sum + i.subtotal, 0);

            // DB 업데이트
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE orders SET items_json = ?, total_amount = ? WHERE order_number = ?`,
                    [JSON.stringify(mergedItems), newTotalAmount, orderNumber],
                    (err) => {
                        if (err) return reject(err);
                        resolve();
                    }
                );
            });
            console.log(`[Order] Order ${orderNumber} merged with new items. New Total: ${newTotalAmount}`);
        } else {
            // 기존 주문서가 없는 경우 신규 등록
            orderNumber = await generateOrderNumber();
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO orders (order_number, customer_id, customer_name, line_id, phone, items_json, total_amount, status, shipping_address)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [orderNumber, customer_id, customer.name, customer.line_id, customer.phone,
                     JSON.stringify(items), totalAmount, orderStatus, shippingAddress],
                    function(err) {
                        if (err) return reject(err);
                        resolve(this.lastID);
                    }
                );
            });
        }

        // 5) 장바구니 비우기
        await new Promise((resolve, reject) => {
            db.run('DELETE FROM cart WHERE customer_id = ?', [customer_id], (err) => {
                if (err) return reject(err);
                resolve();
            });
        });

        console.log(`[Order] New order ${orderNumber} (${orderStatus}) by ${customer.name} (${customer.line_id}), total: ${totalAmount}`);

        // [New] 쿠폰 사용 처리
        if (validCoupon) {
            const usedAtStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
            await new Promise((resolve, reject) => {
                db.run(`UPDATE coupons SET is_used = 1, used_at = ?, order_number = ? WHERE id = ?`,
                    [usedAtStr, orderNumber, validCoupon.id], (err) => {
                        if (err) console.error('[Order] Coupon update error:', err);
                        resolve();
                    });
            });
            syncCouponUsageToSheet(validCoupon.code, orderNumber, usedAtStr);
        }

        // 6) Google Sheets '주문내역' 탭에 동기화 (POS 연동)
        try {
            const auth = await getGoogleSheetsWriteAuth();
            const sheets = google.sheets({ version: 'v4', auth });
            const createdAt = new Date().toISOString().replace('T', ' ').substring(0, 19);

            // 각 상품별로 한 행씩 기록 (병합된 경우 배송비 행은 구글 시트 중복 방지를 위해 제외)
            const itemsToSync = isMerged ? items.filter(it => it.code !== 'SHIPPING_FEE') : items;
            const sheetRows = itemsToSync.map(item => [
                orderNumber,
                createdAt,
                customer.name,
                customer.line_id,
                customer.phone,
                item.code,
                item.name,
                item.brand,
                item.quantity,
                item.subtotal,
                orderStatus,
                shippingAddress
            ]);

            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: `${ORDERS_SHEET}!A:L`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: sheetRows }
            });
            console.log(`[Order] Synced to Google Sheets: ${orderNumber} (${sheetRows.length} rows)`);
        } catch (sheetsErr) {
            console.error('[Order] Google Sheets sync error:', sheetsErr.message);
        }

        // 7) LINE Notify로 신규 주문 발생 알림을 발송합니다.
        try {
            const statusKor = orderStatus === 'preorder_pending' ? '구매예약 대기 🕒' : '결제 대기 💳';
            const itemsSummary = items
                .filter(it => it.code !== 'SHIPPING_FEE')
                .map(it => `- [${it.brand || '브랜드 없음'}] ${it.name} x${it.quantity} (฿${Number(it.subtotal || 0).toLocaleString()})`)
                .join('\n');
            const shippingFeeItem = items.find(it => it.code === 'SHIPPING_FEE');
            const shippingFeeStr = shippingFeeItem ? `฿${shippingFeeItem.subtotal}` : '무료배송 🚚';
            const totalToPay = Number(totalAmount || 0) + (shippingFeeItem ? Number(shippingFeeItem.subtotal || 0) : 0);

            const lineMsg = `
[822 SHOP] ${isMerged ? '🔄 주문 통합 누적 완료 알림' : '🔔 신규 주문 알림'}

주문번호: ${orderNumber}
주문유형: ${orderStatus === 'preorder_pending' ? '도착예정제품 구매예약' : '일반 구매신청'}
현재상태: ${statusKor}

[고객 정보]
- 성함: ${customer.name}
- LINE ID: ${customer.line_id}
- 연락처: ${customer.phone}
- 배송지: ${shippingAddress}

[결제 요약]
- 상품 합계: ฿${Number(totalAmount || 0).toLocaleString()}
- 배송비: ${shippingFeeStr}
- 총 결제예정액: ฿${totalToPay.toLocaleString()}

[주문 상품 목록]
${itemsSummary}
            `.trim();

            sendLineNotification(lineMsg);
        } catch (lineErr) {
            console.error('[Order] LINE Notify 전송 실패:', lineErr.message);
        }

        res.status(201).json({
            success: true,
            orderNumber,
            totalAmount,
            itemCount: items.length,
            status: orderStatus
        });

    } catch (err) {
        console.error('[Order] Error:', err.message);
        res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
    }
});

// GET /api/orders/:customerId — 내 주문 내역 조회
app.get('/api/orders/:customerId', (req, res) => {
    const { customerId } = req.params;
    db.all(
        'SELECT * FROM orders WHERE customer_id = ? ORDER BY id DESC',
        [customerId],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            // items_json 파싱
            const orders = (rows || []).map(row => ({
                ...row,
                items: JSON.parse(row.items_json || '[]')
            }));

            // [Fix] 각 아이템에 catalog_price(카탈로그 원가) 추가
            // → 프론트엔드에서 취소선(원가) + 실제 할인가 표시에 사용
            const allCodes = [...new Set(orders.flatMap(o => (o.items || []).map(it => it.code)).filter(Boolean))];
            if (allCodes.length === 0) return res.json({ orders });

            const placeholders = allCodes.map(() => '?').join(',');
            db.all(
                `SELECT code, price, name_en, name_th FROM products WHERE code IN (${placeholders})`,
                allCodes,
                (err2, products) => {
                    if (err2) return res.json({ orders }); // 실패 시 원본 반환
                    const catalogPriceMap = Object.fromEntries((products || []).map(p => [p.code, Number(p.price) || 0]));
                    const nameEnMap = Object.fromEntries((products || []).map(p => [p.code, p.name_en]));
                    const nameThMap = Object.fromEntries((products || []).map(p => [p.code, p.name_th]));

                    const enrichedOrders = orders.map(order => ({
                        ...order,
                        items: (order.items || []).map(item => {
                            const catalogPrice = catalogPriceMap[item.code];
                            const soldPrice = item.price !== undefined
                                ? Number(item.price)
                                : (item.subtotal && item.quantity > 0
                                    ? Math.round(Number(item.subtotal) / Number(item.quantity))
                                    : 0);
                            return {
                                ...item,
                                catalog_price: catalogPrice, // 카탈로그 원가 (취소선 표시용)
                                sold_price: soldPrice,       // 실제 결제 단가 (할인가)
                                name_en: item.name_en || nameEnMap[item.code] || '',
                                name_th: item.name_th || nameThMap[item.code] || ''
                            };
                        })
                    }));
                    res.json({ orders: enrichedOrders });
                }
            );
        }
    );
});

// PUT /api/orders/:orderNumber/status — 주문 상태 업데이트 (POS에서 결제확인 시 호출)
app.put('/api/orders/:orderNumber/status', (req, res) => {
    const { orderNumber } = req.params;
    const { status, itemCodes } = req.body;

    const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
    if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ error: 'INVALID_STATUS', message: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    db.get('SELECT * FROM orders WHERE order_number = ?', [orderNumber], (err, order) => {
        if (err || !order) return res.status(500).json({ error: err ? err.message : 'Order not found' });

        const items = JSON.parse(order.items_json || '[]');
        let finalStatus = status;
        let updatedItems = items;
        let targetCodes = [];

        if (status === 'confirmed') {
            if (itemCodes && Array.isArray(itemCodes)) {
                updatedItems = items.map(it => {
                    if (itemCodes.includes(it.code) && !it.paid) {
                        targetCodes.push(it.code);
                        return { ...it, paid: true };
                    }
                    return it;
                });
                
                // If some items are still unpaid, we don't change the overarching status to 'confirmed' unless all are paid
                const allPaid = updatedItems.every(it => it.paid);
                if (!allPaid && order.status !== 'confirmed') {
                    finalStatus = order.status; // keep as pending
                }
            } else {
                // Backward compatibility: confirm all unpaid
                updatedItems = items.map(it => {
                    if (!it.paid) {
                        targetCodes.push(it.code);
                        return { ...it, paid: true };
                    }
                    return it;
                });
            }
        } else if (status === 'cancelled') {
            // Cancel all items
            targetCodes = items.map(it => it.code);
        }

        db.run(
            'UPDATE orders SET status = ?, items_json = ? WHERE order_number = ?',
            [finalStatus, JSON.stringify(updatedItems), orderNumber],
            function(err) { // Async removed here to keep 'this' binding simple, using a wrapper inside if needed
                const stmt = this;
                (async () => {
                    if (err) return res.status(500).json({ error: err.message });
                    if (stmt.changes === 0) return res.status(404).json({ error: 'Order not found.' });

                    console.log(`[Order] ${orderNumber} status updated to: ${finalStatus} (requested: ${status})`);

                // 실시간 연동 1: 상태에 따른 재고 처리 (결제 완료 시 차감 / 취소 시 복구, 및 매출 기록)
                if ((status === 'confirmed' || status === 'cancelled') && targetCodes.length > 0) {
                    try {
                        const placeholders = targetCodes.map(() => '?').join(',');
                        // [Fix] 취소 시 재고를 'On Sale'로 명시 복원 (빈 문자열 사용 시 시트에서 On Sale로 잘못 표기되는 문제 방지)
                        const newStockValue = (status === 'confirmed') ? 'Sold Out' : 'On Sale';
                        
                        db.run(`UPDATE products SET stock = ? WHERE code IN (${placeholders})`, [newStockValue, ...targetCodes]);
                        console.log(`[Inventory] ${status === 'confirmed' ? 'Deducted (Sold Out)' : 'Restored (On Sale)'} stock for order ${orderNumber}: ${targetCodes.join(', ')}`);
                        
                        // [Fix] 구글 시트 '사입품목' 탭의 재고 상태도 같이 업데이트 (동기화 시 덮어쓰기 방지)
                        // [Fix] 실제판매가격(V열) 기록: 결제 확인된 상품의 할인 단가를 priceMap으로 구성
                        const soldPriceMap = {};
                        updatedItems.forEach(item => {
                            if (targetCodes.includes(item.code)) {
                                // item.price = 관리자가 수정한 실제 판매가 (없으면 subtotal/quantity로 추정)
                                const unitPrice = item.price !== undefined
                                    ? Number(item.price)
                                    : (item.subtotal && item.quantity > 0
                                        ? Math.round(Number(item.subtotal) / Number(item.quantity))
                                        : 0);
                                soldPriceMap[item.code] = unitPrice;
                            }
                        });
                        await syncStockToGoogleSheets(targetCodes, newStockValue, soldPriceMap);

                        // [Integration] POS_매출기록 중복 기록 방지 (주문내역 시트로 통합)
                        if (status === 'confirmed') {
                            console.log(`[Order] ${orderNumber} confirmed. Sync to POS skipped (integrated).`);
                            
                            // [Fix] 중복 기록 방지: 이미 결제 확인되어 시트에 기록된 상품인지 체크
                            // items_json 내의 'synced_to_sheet' 필드를 활용
                            const newItemsToSync = items.filter(item => targetCodes.includes(item.code) && !item.synced_to_sheet);

                            if (order.customer_id === 0 && newItemsToSync.length > 0) {
                                try {
                                    const auth = await getGoogleSheetsWriteAuth();
                                    const sheets = google.sheets({ version: 'v4', auth });
                                    
                                    const guestSheetRows = newItemsToSync.map(item => [
                                        orderNumber,
                                        order.created_at || soldAt,
                                        order.customer_name,
                                        order.line_id,
                                        order.phone,
                                        item.code,
                                        item.name,
                                        item.brand,
                                        item.quantity,
                                        item.subtotal,
                                        'confirmed', // 결제 완료 상태로 추가
                                        order.shipping_address
                                    ]);
                                    
                                    if (guestSheetRows.length > 0) {
                                        await sheets.spreadsheets.values.append({
                                            spreadsheetId: SPREADSHEET_ID,
                                            range: `${ORDERS_SHEET}!A:L`,
                                            valueInputOption: 'USER_ENTERED',
                                            requestBody: { values: guestSheetRows }
                                        });
                                        console.log(`[Order] Guest order synced to ORDERS_SHEET: ${orderNumber}`);
                                        
                                        // 시트 추가 성공 후, synced_to_sheet 플래그 업데이트
                                        updatedItems = updatedItems.map(it => {
                                            if (targetCodes.includes(it.code)) return { ...it, synced_to_sheet: true };
                                            return it;
                                        });
                                        // DB 재업데이트 (플래그 보존)
                                        db.run('UPDATE orders SET items_json = ? WHERE order_number = ?', [JSON.stringify(updatedItems), orderNumber]);
                                    }
                                } catch (guestErr) {
                                    console.error('[Order] Guest order sheets sync error:', guestErr.message);
                                }
                            }
                        } else if (status === 'cancelled') {
                            // [Fix] 주문 취소/환불 시 POS_매출기록 구글 시트에서 삭제 연동
                            await deleteSalesRecords(targetCodes, orderNumber);

                            // [New] 주문 취소 시 사용된 쿠폰 자동 복구 (SQLite + 구글 시트 동기화)
                            try {
                                const usedCoupon = await new Promise((resolve, reject) => {
                                    db.get('SELECT * FROM coupons WHERE order_number = ?', [orderNumber], (err, row) => {
                                        if (err) return reject(err);
                                        resolve(row);
                                    });
                                });

                                if (usedCoupon) {
                                    await new Promise((resolve, reject) => {
                                        db.run(
                                            'UPDATE coupons SET is_used = 0, used_at = NULL, order_number = NULL WHERE order_number = ?',
                                            [orderNumber],
                                            (err) => {
                                                if (err) return reject(err);
                                                resolve();
                                            }
                                        );
                                    });
                                    console.log(`[Coupon Restore] Restored coupon ${usedCoupon.code} for cancelled order ${orderNumber}`);
                                    
                                    // 구글 시트 동기화
                                    await syncCouponRestoreToSheet(usedCoupon.code);
                                }
                            } catch (couponErr) {
                                console.error('[Coupon Restore] Error restoring coupon:', couponErr.message);
                            }
                        }
                    } catch (e) { console.error('[Inventory] Status update error:', e); }
                }

                // 실시간 연동 2: Google Sheets '주문내역' 상태 동기화
                // If the entire order is confirmed, update it in ORDERS_SHEET
                if (finalStatus !== order.status) {
                    try {
                        const auth = await getGoogleSheetsWriteAuth();
                        const sheets = google.sheets({ version: 'v4', auth });
                        const sheetRes = await sheets.spreadsheets.values.get({
                            spreadsheetId: SPREADSHEET_ID,
                            range: `${ORDERS_SHEET}!A:K`,
                        });
                        const rows = sheetRes.data.values || [];
                        // A열(주문번호), F열(상품코드) 매칭하여 K열(상태) 업데이트
                        const rowUpdates = [];
                        for (let i = 1; i < rows.length; i++) {
                            if (rows[i][0] === orderNumber) {
                                rowUpdates.push({
                                    range: `${ORDERS_SHEET}!K${i + 1}`,
                                    values: [[finalStatus]]
                                });
                            }
                        }
                        if (rowUpdates.length > 0) {
                            await sheets.spreadsheets.values.batchUpdate({
                                spreadsheetId: SPREADSHEET_ID,
                                requestBody: {
                                    valueInputOption: 'USER_ENTERED',
                                    data: rowUpdates
                                }
                            });
                        }
                        console.log(`[Order] Synced status '${finalStatus}' to Google Sheets for ${orderNumber}`);
                    } catch (sheetErr) {
                        console.error('[Order] Google Sheets status sync error:', sheetErr.message);
                    }
                }

                    res.json({ success: true, orderNumber, status: finalStatus, updatedItems });
                })();
            }
        );
    });
});

// =============================================
// 내 정보 수정 API
// 연락처, 주소 정보를 SQLite + 구글 시트 양방향 동기화
// =============================================
app.put('/api/profile/:customerId', async (req, res) => {
    const { customerId } = req.params;
    const { phone, province, district, sub_district, postal_code, address_detail } = req.body;

    // 필수 필드 검증
    if (!phone || !province || !district || !sub_district || !postal_code || !address_detail) {
        return res.status(400).json({ error: 'MISSING_FIELDS', message: '모든 필드를 입력해주세요.' });
    }

    try {
        // 1) SQLite 업데이트
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE customers SET phone = ?, province = ?, district = ?, sub_district = ?, postal_code = ?, address_detail = ? WHERE id = ?`,
                [phone, province, district, sub_district, postal_code, address_detail, customerId],
                function(err) {
                    if (err) return reject(err);
                    if (this.changes === 0) return reject(new Error('Customer not found'));
                    resolve();
                }
            );
        });

        // 2) 구글 시트 '고객정보' 탭 동기화 (비동기, 실패해도 로컬은 이미 수정됨)
        try {
            const auth = await getGoogleSheetsWriteAuth();
            const sheets = google.sheets({ version: 'v4', auth });

            // 고객정보 시트에서 해당 고객의 행 찾기 (B열=라인ID로 매칭)
            const customer = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM customers WHERE id = ?', [customerId], (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                });
            });

            if (customer) {
                const sheetRes = await sheets.spreadsheets.values.get({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${CUSTOMERS_SHEET}!A:J`,
                });
                const rows = sheetRes.data.values || [];
                // B열(인덱스1)이 라인ID인 행을 찾음
                for (let i = 1; i < rows.length; i++) {
                    if (rows[i][1] === customer.line_id) {
                        const rowNum = i + 1;
                        // 연락처(D열), 주소 관련 열 업데이트
                        await sheets.spreadsheets.values.batchUpdate({
                            spreadsheetId: SPREADSHEET_ID,
                            requestBody: {
                                valueInputOption: 'USER_ENTERED',
                                data: [
                                    { range: `${CUSTOMERS_SHEET}!D${rowNum}`, values: [[phone]] },
                                    { range: `${CUSTOMERS_SHEET}!E${rowNum}`, values: [[province]] },
                                    { range: `${CUSTOMERS_SHEET}!F${rowNum}`, values: [[district]] },
                                    { range: `${CUSTOMERS_SHEET}!G${rowNum}`, values: [[sub_district]] },
                                    { range: `${CUSTOMERS_SHEET}!H${rowNum}`, values: [[postal_code]] },
                                    { range: `${CUSTOMERS_SHEET}!I${rowNum}`, values: [[address_detail]] },
                                ]
                            }
                        });
                        console.log(`[Profile] Google Sheets synced for customer ${customerId}`);
                        break;
                    }
                }
            }
        } catch (sheetErr) {
            console.error('[Profile] Google Sheets sync error:', sheetErr.message);
        }

        console.log(`[Profile] Customer ${customerId} profile updated.`);
        res.json({ success: true });

    } catch (err) {
        console.error('[Profile] Update error:', err.message);
        res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
    }
});

// =============================================
// 송장 정보 입력 API (관리자/POS에서 호출)
// 주문번호를 기준으로 택배사명, 송장번호를 기록
// =============================================
app.put('/api/orders/:orderNumber/tracking', (req, res) => {
    const { orderNumber } = req.params;
    const { tracking_number, tracking_company } = req.body;

    console.log(`[Tracking Request] Order: ${orderNumber}, Body:`, req.body);

    if (!tracking_number || !tracking_company) {
        return res.status(400).json({ error: 'MISSING_FIELDS', message: '택배사명과 송장번호를 모두 입력해주세요.' });
    }

    db.run(
        'UPDATE orders SET tracking_number = ?, tracking_company = ?, status = ? WHERE order_number = ?',
        [tracking_number, tracking_company, 'shipped', orderNumber],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Order not found.' });

            console.log(`[Tracking] ${orderNumber}: ${tracking_company} ${tracking_number}`);

            // Google Sheets 동기화 (상태=shipped) - 비동기로 별도 처리 (속도 향상 및 오류 방지)
            (async () => {
                try {
                    const auth = await getGoogleSheetsWriteAuth();
                    const sheets = google.sheets({ version: 'v4', auth });
                    const sheetRes = await sheets.spreadsheets.values.get({
                        spreadsheetId: SPREADSHEET_ID,
                        range: `${ORDERS_SHEET}!A:K`,
                    });
                    const rows = sheetRes.data.values || [];
                    for (let i = 1; i < rows.length; i++) {
                        if (rows[i][0] === orderNumber) {
                            await sheets.spreadsheets.values.update({
                                spreadsheetId: SPREADSHEET_ID,
                                range: `${ORDERS_SHEET}!K${i + 1}`,
                                valueInputOption: 'USER_ENTERED',
                                requestBody: { values: [['shipped']] }
                            });
                        }
                    }
                    console.log(`[Tracking] Synced to Google Sheets: ${orderNumber}`);
                } catch (sheetErr) { console.error('[Tracking] Sheets sync error:', sheetErr.message); }
            })();

            res.json({ success: true, orderNumber, tracking_number, tracking_company });
        }
    );
});

// =============================================
// [관리자 전용] 비회원(Guest) 주문 생성 및 상품 추가/삭제 API
// =============================================

// POST /api/admin/orders/guest — 비회원 주문 생성
app.post('/api/admin/orders/guest', async (req, res) => {
    try {
        const { guest_name } = req.body;
        if (!guest_name) return res.status(400).json({ error: 'MISSING_FIELDS', message: '게스트 이름을 입력해주세요.' });

        const orderNumber = await generateOrderNumber();
        const items = [];
        const totalAmount = 0;

        // [개선] 등록 고객인지 확인하여 전화번호/주소 자동 반영
        const managedCustomer = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM managed_customers WHERE LOWER(customer_id) = LOWER(?)', [guest_name], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });

        const phone = managedCustomer?.phone || '000-0000-0000';
        const shippingAddress = managedCustomer?.address || '현장구매(Guest)';
        
        db.run(
            `INSERT INTO orders (order_number, customer_id, customer_name, line_id, phone, items_json, total_amount, status, shipping_address)
             VALUES (?, 0, ?, ?, ?, ?, ?, 'pending', ?)`,
            [orderNumber, guest_name, guest_name, phone, JSON.stringify(items), totalAmount, shippingAddress],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                console.log(`[Admin] Created Guest Order: ${orderNumber} for ${guest_name} (managed: ${!!managedCustomer})`);
                res.status(201).json({ success: true, orderNumber });
            }
        );
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/admin/orders/:orderNumber/items — 주문에 상품 추가 (수정 가능 가격 적용)
app.post('/api/admin/orders/:orderNumber/items', async (req, res) => {
    const { orderNumber } = req.params;
    const { product_code, price, quantity = 1, is_manual, name: manualName } = req.body;

    if (!is_manual && !product_code) {
        return res.status(400).json({ error: 'MISSING_FIELDS', message: '상품 코드가 필요합니다.' });
    }

    try {
        let product;
        if (is_manual) {
            // 수동 입력 모드: 가상 상품 객체 생성
            product = {
                code: `MANUAL-${Date.now()}`,
                name: manualName || '미등록 상품',
                brand: '미등록',
                price: Number(price) || 0,
                thumbnail_url: null
            };
            console.log(`[Admin] Adding manual item: ${product.name} to order ${orderNumber}`);
        } else {
            // 표준 모드: DB에서 상품 검색
            product = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM products WHERE code = ?', [product_code], (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                });
            });
            if (!product) return res.status(404).json({ error: 'NOT_FOUND', message: '상품을 찾을 수 없습니다.' });
        }

        db.get('SELECT * FROM orders WHERE order_number = ?', [orderNumber], (err, order) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!order) return res.status(404).json({ error: 'NOT_FOUND', message: '주문을 찾을 수 없습니다.' });

            let items = JSON.parse(order.items_json || '[]');
            
            // [Fix] 기존 아이템들 중 paid 필드가 없는 경우, 주문 상태가 confirmed 계열이면 true로 소급 적용
            const isHistoricallyPaid = ['confirmed', 'shipped', 'delivered'].includes(order.status);
            items = items.map(it => ({
                ...it,
                paid: it.paid !== undefined ? it.paid : isHistoricallyPaid
            }));

            const finalPrice = price !== undefined ? Number(price) : Number(product.price);
            
            items.push({
                code: product.code,
                name: product.name,
                brand: product.brand,
                thumbnail_url: product.thumbnail_url,
                price: finalPrice,
                quantity: Number(quantity),
                subtotal: finalPrice * Number(quantity),
                paid: false // [New] 신규 추가 상품은 기본적으로 '미결제' 상태
            });

            const totalAmount = items.reduce((sum, i) => sum + i.subtotal, 0);
            
            // [Fix] 이미 결제완료된 주문에 상품이 추가되면 다시 '결제 대기' 상태로 전환하여 추가 결제 유도
            let newStatus = order.status;
            if (order.status !== 'cancelled') {
                newStatus = 'pending';
            }

            db.run(
                'UPDATE orders SET items_json = ?, total_amount = ?, status = ? WHERE order_number = ?',
                [JSON.stringify(items), totalAmount, newStatus, orderNumber],
                async function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    
                    // [New] 배송비 자동 계산 및 업데이트
                    try {
                        const syncResult = await syncShippingFee(orderNumber);
                        res.json({ 
                            success: true, 
                            items: syncResult.items, 
                            totalAmount: syncResult.totalAmount, 
                            status: newStatus 
                        });
                    } catch (syncErr) {
                        console.error('[Shipping] Auto-calculation error:', syncErr.message);
                        res.json({ success: true, items, totalAmount, status: newStatus });
                    }
                }
            );
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/admin/orders/:orderNumber/items/:code — 주문에서 지정한 상품 삭제
app.delete('/api/admin/orders/:orderNumber/items/:code', (req, res) => {
    const { orderNumber, code } = req.params;

    db.get('SELECT * FROM orders WHERE order_number = ?', [orderNumber], (err, order) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!order) return res.status(404).json({ error: 'NOT_FOUND', message: '주문을 찾을 수 없습니다.' });

        let items = JSON.parse(order.items_json || '[]');
        
        // 소급 적용
        const isHistoricallyPaid = ['confirmed', 'shipped', 'delivered'].includes(order.status);
        items = items.map(it => ({
            ...it,
            paid: it.paid !== undefined ? it.paid : isHistoricallyPaid
        }));

        const targetItem = items.find(item => item.code === code);
        items = items.filter(item => item.code !== code);
        const totalAmount = items.reduce((sum, i) => sum + i.subtotal, 0);

        // [Fix] 삭제된 상품이 결제된 상태였거나 confirmed 주문이었다면 재고 복구 및 매출 삭제
        if (targetItem?.paid || isHistoricallyPaid) {
            db.run("UPDATE products SET stock = '' WHERE code = ?", [code]);
            console.log(`[Inventory] Restored stock for removed item ${code} from order ${orderNumber}`);
            deleteSalesRecords([code], orderNumber).catch(e => console.error('[POS] deleteSalesRecord error:', e));
            
            // [Fix] 구글 시트 '사입품목' 탭도 비워줌 (동기화 에러 방지)
            syncStockToGoogleSheets([code], '').catch(e => console.error('[Inventory] Sync error on delete:', e));
        }

        let newStatus = order.status;
        if (order.status !== 'cancelled') {
            // [Fix] 남은 모든 상품이 결제완료 상태라면 pending으로 돌리지 않고 confirmed 유지
            const allRemainingPaid = items.length > 0 && items.every(it => it.paid);
            if (allRemainingPaid) {
                newStatus = 'confirmed';
            } else {
                newStatus = 'pending';
            }
        }

        db.run(
            'UPDATE orders SET items_json = ?, total_amount = ?, status = ? WHERE order_number = ?',
            [JSON.stringify(items), totalAmount, newStatus, orderNumber],
            async function(err) {
                if (err) return res.status(500).json({ error: err.message });
                
                // [New] 배송비 자동 계산 및 업데이트
                try {
                    const syncResult = await syncShippingFee(orderNumber);
                    res.json({ 
                        success: true, 
                        items: syncResult.items, 
                        totalAmount: syncResult.totalAmount, 
                        status: newStatus 
                    });
                } catch (syncErr) {
                    res.json({ success: true, items, totalAmount, status: newStatus });
                }
            }
        );
    });
});

/**
 * PUT /api/admin/orders/:orderNumber/items/:code/cancel-payment
 * 주문 내 특정 상품의 결제를 취소 (관리자 전용)
 */
app.put('/api/admin/orders/:orderNumber/items/:code/cancel-payment', async (req, res) => {
    const { orderNumber, code } = req.params;

    db.get('SELECT * FROM orders WHERE order_number = ?', [orderNumber], async (err, order) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!order) return res.status(404).json({ error: 'NOT_FOUND' });

        let items = JSON.parse(order.items_json || '[]');
        
        // 소급 적용
        const isHistoricallyPaid = ['confirmed', 'shipped', 'delivered'].includes(order.status);
        let targetExists = false;
        
        items = items.map(it => {
            if (it.code === code) {
                it.paid = false;
                targetExists = true;
            } else if (it.paid === undefined) {
                it.paid = isHistoricallyPaid;
            }
            return it;
        });

        if (!targetExists) return res.status(404).json({ error: 'ITEM_NOT_FOUND' });

        // 재고 복구 (Sold Out -> Available)
        db.run("UPDATE products SET stock = '' WHERE code = ?", [code]);

        // 구글 시트 매출 기록 삭제 및 제품 상태 동기화
        try {
            await deleteSalesRecords([code], orderNumber);
            await syncStockToGoogleSheets([code], ''); // [Fix] 구글 시트 상태도 비워줌
        } catch (e) {
            console.error('[POS] deleteSalesRecord/sync error:', e.message);
        }

        // 전체 주문 상태 결정: 하나라도 미결제가 있으면 'pending'
        const allPaid = items.every(it => it.paid);
        const newStatus = allPaid ? order.status : 'pending';

        db.run(
            'UPDATE orders SET items_json = ?, status = ? WHERE order_number = ?',
            [JSON.stringify(items), newStatus, orderNumber],
            async function(err) {
                if (err) return res.status(500).json({ error: err.message });
                
                // [New] 배송비 자동 계산 및 업데이트 (결제 취소 시에도 수량/금액 변화 가능성 대응)
                try {
                    const syncResult = await syncShippingFee(orderNumber);
                    res.json({ success: true, items: syncResult.items, status: newStatus });
                } catch (syncErr) {
                    res.json({ success: true, items, status: newStatus });
                }
            }
        );
    });
});

/**
 * PUT /api/admin/orders/:orderNumber/items/:code/price
 */
app.put('/api/admin/orders/:orderNumber/items/:code/price', async (req, res) => {
    const { orderNumber, code } = req.params;
    const { price } = req.body;

    if (price === undefined) return res.status(400).json({ error: 'MISSING_FIELDS' });

    db.get('SELECT items_json, status FROM orders WHERE order_number = ?', [orderNumber], (err, order) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!order) return res.status(404).json({ error: 'NOT_FOUND' });

        let items = JSON.parse(order.items_json || '[]');
        let modified = false;
        items = items.map(it => {
            if (it.code === code) {
                it.price = Number(price);
                it.subtotal = it.price * it.quantity;
                modified = true;
            }
            return it;
        });

        if (!modified) return res.status(404).json({ error: 'ITEM_NOT_FOUND' });

        const totalAmount = items.reduce((sum, i) => sum + i.subtotal, 0);
        
        // 가격 수정 시에도 결제 대기 상태로 전환 (단, preorder_pending 상태는 예약 대기 상태로 유지)
        let newStatus = order.status;
        if (order.status !== 'cancelled' && order.status !== 'preorder_pending') {
            newStatus = 'pending';
        }

        db.run(
            'UPDATE orders SET items_json = ?, total_amount = ?, status = ? WHERE order_number = ?',
            [JSON.stringify(items), totalAmount, newStatus, orderNumber],
            async function(err) {
                if (err) return res.status(500).json({ error: err.message });
                
                // [New] 배송비 자동 계산 및 업데이트
                try {
                    const syncResult = await syncShippingFee(orderNumber);
                    res.json({ 
                        success: true, 
                        items: syncResult.items, 
                        totalAmount: syncResult.totalAmount, 
                        status: newStatus 
                    });
                } catch (syncErr) {
                    res.json({ success: true, items, totalAmount, status: newStatus });
                }
            }
        );
    });
});

/**
 * PUT /api/admin/orders/:orderNumber/address
 * 일반주문관리 - 주문 주소 수정
 */
app.put('/api/admin/orders/:orderNumber/address', async (req, res) => {
    const { orderNumber } = req.params;
    const { shipping_address } = req.body;

    if (!shipping_address) return res.status(400).json({ error: 'MISSING_FIELDS' });

    db.run(
        'UPDATE orders SET shipping_address = ? WHERE order_number = ?',
        [shipping_address, orderNumber],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
            res.json({ success: true, shipping_address });
        }
    );
});

// GET /api/admin/orders — 관리자용 모든 주문 조회
app.get('/api/admin/orders', (req, res) => {
    const { search_type, search_query, date } = req.query;
    
    let query = 'SELECT * FROM orders';
    const params = [];
    let whereClauses = [];
    
    // 1. 검색어 필터링
    if (search_type && search_query) {
        if (search_type === 'order_number') {
            whereClauses.push('order_number LIKE ?');
            params.push(`%${search_query}%`);
        } else if (search_type === 'tracking_number') {
            whereClauses.push('tracking_number LIKE ?');
            params.push(`%${search_query}%`);
        } else if (search_type === 'phone') {
            whereClauses.push('phone LIKE ?');
            params.push(`%${search_query}%`);
        } else if (search_type === 'customer_id') {
            whereClauses.push('(line_id LIKE ? OR login_id LIKE ?)');
            params.push(`%${search_query}%`, `%${search_query}%`);
        }
    }

    // 2. 날짜 필터링 (YYYY-MM-DD)
    if (date) {
        whereClauses.push("created_at LIKE ?");
        params.push(`${date}%`);
    }

    if (whereClauses.length > 0) {
        query += ' WHERE ' + whereClauses.join(' AND ');
    }
    
    query += ' ORDER BY id DESC';
    
    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        (async () => {
            try {
                let orders = (rows || []).map(row => {
                    try {
                        return {
                            ...row,
                            items: JSON.parse(row.items_json || '[]')
                        };
                    } catch (e) {
                        console.error(`[DB] JSON parse error for order ${row.order_number}:`, e.message);
                        return { ...row, items: [], corrupt: true };
                    }
                });
        
        // SQLite DB에서 상품 썸네일 정보 가져오기 (과거 주문의 이미지 누락 보완)
        const allItemCodes = [...new Set(orders.flatMap(o => Array.isArray(o.items) ? o.items.map(it => it.code) : []).filter(Boolean))];
        if (allItemCodes.length > 0) {
            const placeholders = allItemCodes.map(() => '?').join(',');
            try {
                const products = await new Promise((resolve, reject) => {
                    db.all(`SELECT code, thumbnail_url, image_url, name_en, name_th FROM products WHERE code IN (${placeholders})`, allItemCodes, (err, pRows) => {
                        if (err) return reject(err);
                        resolve(pRows || []);
                    });
                });
                
                const imgMap = Object.fromEntries(products.map(p => [p.code, p.thumbnail_url || p.image_url]));
                const nameEnMap = Object.fromEntries(products.map(p => [p.code, p.name_en]));
                const nameThMap = Object.fromEntries(products.map(p => [p.code, p.name_th]));
                
                orders = orders.map(order => ({
                    ...order,
                    items: order.items.map(it => ({
                        ...it,
                        thumbnail_url: it.thumbnail_url || imgMap[it.code] || null,
                        name_en: it.name_en || nameEnMap[it.code] || '',
                        name_th: it.name_th || nameThMap[it.code] || ''
                    }))
                }));
            } catch (e) {
                console.error('[Admin Orders] Failed to fetch thumbnails:', e.message);
            }
        }
        
                res.json({ orders });
            } catch (fatalErr) {
                console.error('[Admin Orders] Fatal error processing orders:', fatalErr.message);
                res.status(500).json({ error: 'SERVER_ERROR', message: fatalErr.message });
            }
        })();
    });
});

// DELETE /api/admin/orders/:orderNumber — 관리자용 주문 삭제 (로컬 DB 및 구글 스프레드시트 동기화 삭제)
app.delete('/api/admin/orders/:orderNumber', async (req, res) => {
    const { orderNumber } = req.params;

    // 1. 로컬 SQLite DB에서 주문 데이터 삭제
    db.run('DELETE FROM orders WHERE order_number = ?', [orderNumber], async function(err) {
        if (err) return res.status(500).json({ error: err.message });
        const changes = this.changes;

        // 2. 구글 스프레드시트 '주문내역' 탭에서 해당 주문 번호의 모든 행 삭제
        try {
            const auth = await getGoogleSheetsWriteAuth();
            const sheets = google.sheets({ version: 'v4', auth });
            
            // 주문내역 A열(주문번호 열) 전체를 가져옴
            const sheetRes = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${ORDERS_SHEET}!A:A`
            });
            const rows = sheetRes.data.values || [];
            
            // 삭제하려는 주문번호(orderNumber)가 들어있는 모든 행의 인덱스(0부터 시작) 수집
            const targetIndices = [];
            rows.forEach((row, idx) => {
                if (String(row[0]).trim() === orderNumber) {
                    targetIndices.push(idx);
                }
            });

            // 매칭되는 행이 존재한다면 구글 스프레드시트에서 삭제 실행
            if (targetIndices.length > 0) {
                const metaRes = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
                const sheet = metaRes.data.sheets.find(s => s.properties.title === ORDERS_SHEET);
                
                if (sheet) {
                    // 중요: 구글 시트 행을 지울 때 앞의 행을 지우면 뒤쪽 인덱스가 앞으로 밀리므로,
                    // 큰 인덱스(아래쪽 행)부터 역순(descending)으로 정렬해 삭제 요청을 생성합니다.
                    const requests = targetIndices.sort((a, b) => b - a).map(rowIndex => ({
                        deleteDimension: {
                            range: {
                                sheetId: sheet.properties.sheetId,
                                dimension: 'ROWS',
                                startIndex: rowIndex,
                                endIndex: rowIndex + 1
                            }
                        }
                    }));

                    // 일괄 배치 업데이트 실행
                    await sheets.spreadsheets.batchUpdate({
                        spreadsheetId: SPREADSHEET_ID,
                        requestBody: { requests }
                    });
                    console.log(`[Admin] Order ${orderNumber} rows successfully deleted from Google Sheets (${targetIndices.length} rows)`);
                }
            }
        } catch (sErr) {
            // 구글 시트 삭제 에러 발생 시 로그만 출력하여 API 응답이 실패하지 않도록 처리
            console.error('[Admin] Google Sheets Sync Error on Order Delete:', sErr.message);
        }

        res.json({ success: true, changes });
    });
});

// [Preorder] 구글 시트 '사입품목' 탭의 가격(M열) 및 재고 상태(N열)를 업데이트하는 구매예약 확정 헬퍼 함수
async function syncPreorderToGoogleSheets(productCode, price, status = 'reserved') {
    if (!productCode) return;
    try {
        const auth = await getGoogleSheetsWriteAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        
        // A~AA열까지의 데이터를 가져와 행 위치 파악
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: '사입품목!A:AF',
        });
        const rows = res.data.values || [];
        if (rows.length <= 1) return;
        
        const updates = [];
        const cleanCode = String(productCode).replace('.0', '').trim();

        for (let i = 1; i < rows.length; i++) {
            const pCode = String(rows[i][0]).replace('.0', '').trim();
            if (pCode === cleanCode) {
                // H열: 가격 업데이트
                updates.push({
                    range: `사입품목!H${i + 1}`,
                    values: [[price]]
                });
                // E열: 재고 상태 업데이트
                updates.push({
                    range: `사입품목!E${i + 1}`,
                    values: [[status]]
                });
                break;
            }
        }
        
        if (updates.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data: updates
                }
            });
            console.log(`[Preorder Sheets] Synced price=${price}, status=${status} to Google Sheets for: ${cleanCode}`);
        }
    } catch (err) {
        console.error('[Preorder Sheets] syncPreorderToGoogleSheets error:', err.message);
    }
}

// PUT /api/admin/orders/:orderNumber/confirm-preorder — 관리자용 구매예약 확정 API
app.put('/api/admin/orders/:orderNumber/confirm-preorder', async (req, res) => {
    const { orderNumber } = req.params;
    const { updated_prices } = req.body; // { "상품코드": 가격, ... } 형태

    if (!updated_prices || typeof updated_prices !== 'object') {
        return res.status(400).json({ error: 'INVALID_REQUEST', message: 'updated_prices object is required.' });
    }

    db.get('SELECT * FROM orders WHERE order_number = ?', [orderNumber], async (err, order) => {
        if (err || !order) return res.status(500).json({ error: err ? err.message : 'Order not found' });

        try {
            let items = JSON.parse(order.items_json || '[]');
            
            // 1. 주문 상품들의 가격 업데이트
            items = items.map(item => {
                if (item.is_preorder && updated_prices[item.code] !== undefined) {
                    const newPrice = Number(updated_prices[item.code]) || 0;
                    return {
                        ...item,
                        price: newPrice,
                        subtotal: newPrice * item.quantity,
                        paid: true
                    };
                }
                return item;
            });

            // 배송비 재계산
            // [New] 쿠폰 할인 적용
        if (validCoupon) {
            let discountAmount = 0;
            if (validCoupon.type === 'amount') {
                discountAmount = validCoupon.value;
                const itemsSubtotal = items.reduce((sum, i) => sum + i.subtotal, 0);
                if (discountAmount > itemsSubtotal) discountAmount = itemsSubtotal;
            } else if (validCoupon.type === 'rate') {
                const targetItem = items.find(it => it.code === coupon_target_product);
                if (targetItem) {
                    discountAmount = Math.floor(targetItem.subtotal * (validCoupon.value / 100));
                }
            }

            if (discountAmount > 0) {
                items.push({
                    code: 'COUPON_DISCOUNT',
                    name: '쿠폰 할인 (' + validCoupon.code + ')',
                    brand: '-',
                    price: -discountAmount,
                    quantity: 1,
                    subtotal: -discountAmount,
                    paid: false
                });
            }
        }

        const fee = calculateShippingFee(items);
            // 기존 배송비 제거 후 필요시 재삽입
            items = items.filter(it => it.code !== 'SHIPPING_FEE');
            if (fee > 0) {
                items.push({
                    code: 'SHIPPING_FEE',
                    name: 'Shipping Fee',
                    brand: '-',
                    price: fee,
                    quantity: 1,
                    subtotal: fee,
                    paid: true
                });
            }

            // 총매출액(total_amount)은 배송비를 제외한 상품들의 합계로 계산
            const totalAmount = items
                .filter(it => it.code !== 'SHIPPING_FEE')
                .reduce((sum, i) => sum + (Number(i.subtotal) || 0), 0);

            // 2. 주문 상태를 'confirmed'로 업데이트
            await new Promise((resolve, reject) => {
                db.run(
                    'UPDATE orders SET status = ?, items_json = ?, total_amount = ? WHERE order_number = ?',
                    ['confirmed', JSON.stringify(items), totalAmount, orderNumber],
                    function(err2) {
                        if (err2) return reject(err2);
                        resolve();
                    }
                );
            });

            // 3. 각 예약 상품 정보(products) 업데이트: 가격을 변경하고 stock을 'reserved'로 수정
            const preorderItems = items.filter(it => it.is_preorder);
            for (const item of preorderItems) {
                const newPrice = Number(updated_prices[item.code]) || 0;
                await new Promise((resolve, reject) => {
                    db.run(
                        "UPDATE products SET price = ?, stock = 'reserved' WHERE code = ?",
                        [newPrice.toString(), item.code],
                        function(err3) {
                            if (err3) return reject(err3);
                            resolve();
                        }
                    );
                });

                // 구글 시트와 실시간 동기화 호출
                await syncPreorderToGoogleSheets(item.code, newPrice, 'reserved');
            }

            console.log(`[Preorder] Confirmed preorder ${orderNumber}, updated items total: ${totalAmount}`);
            res.json({ success: true, orderNumber, totalAmount, status: 'confirmed' });

        } catch (e) {
            console.error('[Preorder Confirm] Error:', e.message);
            res.status(500).json({ error: 'SERVER_ERROR', message: e.message });
        }
    });
});

// GET /api/customer/:customerId — 고객 정보 조회 (마이페이지용)
app.get('/api/customer/:customerId', (req, res) => {
    const { customerId } = req.params;
    db.get(
        'SELECT id, name, login_id, line_id, phone, province, district, sub_district, postal_code, address_detail, role, created_at FROM customers WHERE id = ?',
        [customerId],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
            res.json({ customer: row });
        }
    );
});

// =============================================
// [POS 이식] 관리자 전용 POS 판매 처리 API
// =============================================

/**
 * 1) POST /api/admin/sell-direct
 * 관리자가 상품 코드를 전달하면 즉시 품절 처리하고 구글 시트에 매출 기록
 */
app.post('/api/admin/sell-direct', async (req, res) => {
    const { product_code, sale_note, price } = req.body;
    
    if (!product_code) {
        return res.status(400).json({ error: 'MISSING_FIELDS', message: '상품 코드를 입력해주세요.' });
    }

    try {
        // 1. 상품 정보 조회 (가격 등 매출 기록용)
        const product = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM products WHERE code = ?', [product_code], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });

        if (!product) {
            return res.status(404).json({ error: 'PRODUCT_NOT_FOUND', message: '해당 상품을 찾을 수 없습니다.' });
        }

        // 2. 로컬 DB 재고 상태 → Sold Out 업데이트
        await new Promise((resolve, reject) => {
            db.run(
                "UPDATE products SET stock = 'Sold Out' WHERE code = ?",
                [product_code],
                function(err) {
                    if (err) return reject(err);
                    resolve(this.changes);
                }
            );
        });

        // 3. 구글 시트 POS_매출기록 탭에 매출 행 추가
        try {
            const auth = await getGoogleSheetsWriteAuth();
            const sheets = google.sheets({ version: 'v4', auth });
            const soldAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
            
            // 전달받은 price가 있으면 사용, 없으면 상품의 원본 가격 사용
            const finalPrice = price !== undefined ? price : product.price;

            // 현장 판매용 가상 주문번호 생성 (POS-YYYYMMDD-HHMMSS)
            const posOrderNumber = `POS-${new Date().toISOString().replace(/[-:T.]/g, '').substring(0, 14)}`;

            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: `${ORDERS_SHEET}!A:L`,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [[
                        posOrderNumber,      // A: 주문번호
                        soldAt,              // B: 주문일시
                        '현장판매',          // C: 고객명
                        'pos',               // D: 라인ID
                        '-',                 // E: 전화번호
                        product_code,        // F: 상품코드
                        product.name,        // G: 상품명
                        product.brand,       // H: 브랜드
                        1,                   // I: 수량
                        finalPrice,          // J: 금액
                        'confirmed',         // K: 상태
                        'POS'                // L: 주소
                    ]]
                }
            });
            console.log(`[POS] Synced to Google Sheets (ORDERS_SHEET): ${product_code}`);

            // [Fix] 직판 시 '사입품목' 탭의 재고 상태도 'Sold Out'으로 실시간 업데이트
            // [Fix] 직판 시 실제판매가격(V열) 기록
            await syncStockToGoogleSheets([product_code], 'Sold Out', { [product_code]: Number(finalPrice) });

        } catch (sheetsErr) {
            // 시트 동기화 실패는 로그만 남기고 응답은 성공 처리 (로컬 DB는 완료됨)
            console.error('[POS] Google Sheets sync error (POS_매출기록):', sheetsErr.message);
        }

        // 4. 브랜드 캐시 갱신 (통계용)
        refreshBrandCache().catch(e => console.error('[POS] Brand cache refresh error:', e));

        console.log(`[POS] Sell Direct Success: ${product_code} (${product.name})`);
        res.json({ success: true, product_code, product_name: product.name });

    } catch (err) {
        console.error('[POS] Sell Direct Error:', err.message);
        res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
    }
});

/**
 * 2) POST /api/admin/restore-stock
 * 실수로 품절 처리한 상품을 다시 판매 가능 상태('')로 복구
 */
app.post('/api/admin/restore-stock', async (req, res) => {
    const { product_code } = req.body;
    
    if (!product_code) {
        return res.status(400).json({ error: 'MISSING_FIELDS' });
    }

    try {
        await new Promise((resolve, reject) => {
            db.run(
                "UPDATE products SET stock = '' WHERE code = ?",
                [product_code],
                function(err) {
                    if (err) return reject(err);
                    resolve(this.changes);
                }
            );
        });
        
        await syncStockToGoogleSheets([product_code], ''); // [Fix] 구글 시트 상태 비워줌
        
        refreshBrandCache().catch(e => console.error('[POS] Brand cache refresh error:', e));
        
        console.log(`[POS] Stock Restored (and synced to Sheets): ${product_code}`);
        res.json({ success: true, product_code });
    } catch (err) {
        console.error('[POS] Restore Stock Error:', err.message);
        res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
    }
});

/**
 * 3) GET /api/admin/sales
 * 구글 시트 'POS_매출기록' 탭 데이터를 가져와서 관리자 화면에 표시
 */
app.get('/api/admin/sales', async (req, res) => {
    try {
        const auth = await getGoogleSheetsAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        const result = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${ORDERS_SHEET}!A:L`,
        });
        
        const rows = result.data.values || [];
        if (rows.length <= 1) {
            return res.json({ sales: [] });
        }

        const headers = rows[0];

        // 주문내역(ORDERS_SHEET) 고정 컬럼 매칭 (사용자 요청: B:주문일시, F:상품코드, H:브랜드, J:가격)
        // 추가 매핑 (기존 로직 기준): G:상품명, K:상태, A:비고(주문번호)
        const colDate   = 1;  // B
        const colCode   = 5;  // F
        const colName   = 6;  // G
        const colBrand  = 7;  // H
        const colPrice  = 9;  // J
        const colNote   = 0;  // A
        const colStatus = 10; // K
        const colCustId = 3;  // D
        const colCustName = 2; // C
        
        console.log(`[Sales API] Fixed Mapping (주문내역) => date:${colDate} code:${colCode} brand:${colBrand} price:${colPrice} note:${colNote} status:${colStatus} custId:${colCustId} custName:${colCustName}`);

        const confirmedSales = rows.map((row, idx) => ({ row, sheetIndex: idx + 1 }))
            .slice(1) // 헤더 제외
            .filter(item => {
                const status = String(item.row[colStatus] || '').toLowerCase().trim();
                // 'confirmed'(결제완료)를 기본으로 하되, 이미 프로세스가 진행된 배송중/완료 상태도 매출에 포함
                return ['confirmed', 'shipped', 'delivered', '\uACB0\uC81C\uC644\uB8CC', '\uBC30\uC1A1\uC911', '\uBC30\uC1A1\uC644\uB8CC'].includes(status);
            });

        // 고객관리(managed_customers) 데이터 미리 로드 (guest 매칭용)
        const managedCusts = await new Promise((resolve) => {
            db.all('SELECT customer_id FROM managed_customers', [], (err, rows) => {
                resolve(rows || []);
            });
        });
        const managedIdSet = new Set(managedCusts.map(c => String(c.customer_id).toLowerCase()));

        const rawSales = confirmedSales.map((item) => {
            const row = item.row;
            const rowIndex = item.sheetIndex;
            const get = (i) => (i >= 0 && i < row.length) ? (row[i] || '') : '';
            
            const sheetCustId = get(colCustId);
            const sheetCustName = get(colCustName);
            
            // [Fix] 아이디가 guest이거나 pos인 경우, 고객명과 매칭되는 등록 아이디가 있는지 확인
            let finalCustId = sheetCustId;
            if (['guest', 'pos', ''].includes(String(sheetCustId).toLowerCase())) {
                const lowerName = String(sheetCustName).toLowerCase().trim();
                if (managedIdSet.has(lowerName)) {
                    finalCustId = sheetCustName; // 고객명이랑 아이디가 같은 경우 (관리자 등록 방식)
                }
            }

            return {
                rowIndex,
                '\ud310\ub9e4\uc77c\uc2dc': get(colDate),
                '\uc0c1\ud488\ucf54\ub4dc': get(colCode),
                '\uc0c1\ud488\uba85':   get(colName),
                '\ube0c\ub79c\ub4dc':   get(colBrand),
                '\ud310\ub9e4\uac00\uaca9': get(colPrice),
                '\ube44\uace0':     get(colNote),
                '\uace0\uac1d\uc544\uc774\ub514': finalCustId,
                '\uace0\uac1d\uba85': sheetCustName,
            };
        });

        // SQLite DB에서 상품 썸네일 정보 가져오기
        const productCodes = [...new Set(rawSales.map(s => s['상품코드']).filter(Boolean))];
        if (productCodes.length === 0) {
            return res.json({ sales: rawSales.reverse() });
        }

        const placeholders = productCodes.map(() => '?').join(',');
        const products = await new Promise((resolve, reject) => {
            db.all(`SELECT code, thumbnail_url, brand, category, upper_category FROM products WHERE code IN (${placeholders})`, productCodes, (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });

        const productMap = Object.fromEntries(products.map(p => [p.code, p]));

        const salesWithThumb = rawSales.map(sale => {
            const prod = productMap[sale['상품코드']] || {};
            // If the sheet's brand is missing or looks like a number (contamination), use DB brand
            const sheetBrand = sale['브랜드'] || '';
            const isContaminated = /^\d+(\.\d+)?$/.test(String(sheetBrand).trim());
            const correctBrand = (isContaminated || !sheetBrand) ? (prod.brand || sheetBrand || '기타') : sheetBrand;

            return {
                ...sale,
                thumbnail_url: prod.thumbnail_url || null,
                '브랜드': correctBrand,
                category: prod.category || '기타',
                upper_category: prod.upper_category || '기타',
            };
        });

        res.json({ sales: salesWithThumb.reverse() }); // 최신 판매순
    } catch (err) {
        console.error('[POS] Fetch Sales Error:', err.message);
        res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
    }
});

// DELETE /api/admin/sales/:rowIndex — 매출 기록 개별 삭제
app.delete('/api/admin/sales/:rowIndex', async (req, res) => {
    try {
        const rowIndex = parseInt(req.params.rowIndex, 10);
        if (isNaN(rowIndex) || rowIndex < 1) {
            return res.status(400).json({ error: 'INVALID_INDEX' });
        }
        
        const auth = await getGoogleSheetsWriteAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        
        const metaRes = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        const sheet = metaRes.data.sheets.find(s => s.properties.title === ORDERS_SHEET);
        if (!sheet) return res.status(404).json({ error: 'SHEET_NOT_FOUND', message: '주문내역 시트를 찾을 수 없습니다.' });
        
        const sheetId = sheet.properties.sheetId;

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
                requests: [{
                    deleteDimension: {
                        range: {
                            sheetId: sheetId,
                            dimension: 'ROWS',
                            startIndex: rowIndex - 1,     // 0-based
                            endIndex: rowIndex
                        }
                    }
                }]
            }
        });
        
        console.log(`[POS] Manually deleted sales record at rowIndex: ${rowIndex}`);
        res.json({ success: true, rowIndex });
    } catch (err) {
        console.error('[POS] Delete Sale Error:', err.message);
        res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
    }
});

// =============================================
// [위탁판매] 관리자 전용 위탁판매 관리 API
// 매장에서 위탁자에게 넘긴 상품을 추적/관리
// =============================================

/**
 * POST /api/admin/consignment
 * 상품번호 배열을 받아 일괄 위탁 등록
 * body: { codes: ['301', '403', '201'] }
 */
app.post('/api/admin/consignment', async (req, res) => {
    const { codes } = req.body;

    if (!codes || !Array.isArray(codes) || codes.length === 0) {
        return res.status(400).json({ error: 'MISSING_FIELDS', message: '등록할 상품 번호가 필요합니다.' });
    }

    const validCodes = codes.map(c => String(c).trim()).filter(c => c.length > 0);
    if (validCodes.length === 0) {
        return res.status(400).json({ error: 'INVALID_INPUT', message: '유효한 상품 번호가 없습니다.' });
    }

    try {
        const auth = await getGoogleSheetsWriteAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        const registeredAt = new Date().toISOString().replace('T', ' ').substring(0, 19);

        // 1. 헤더 체크 및 삽입 (필요시)
        const checkRes = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${CONSIGNMENT_SHEET}!A1:A1`,
        });
        if (!checkRes.data.values || checkRes.data.values.length === 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${CONSIGNMENT_SHEET}!A1:H1`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [['등록일시', '상품코드', '상태', '판매일시', '커미션율', '커미션금액', '정산금액', '판매차수']] }
            });
        }

        // 2. 데이터 추가 (E-H열은 빈 값)
        const rows = validCodes.map(code => [registeredAt, code, 'active', '', '', '', '', '']);
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${CONSIGNMENT_SHEET}!A:H`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: rows }
        });

        // 3. 로컬 DB 동시 저장 (캐시/안전망용, 실패해도 시트가 우선)
        const stmt = db.prepare(`INSERT INTO consignment_items (product_code, status, registered_at) VALUES (?, 'active', ?)`);
        validCodes.forEach(code => stmt.run([code, registeredAt]));
        stmt.finalize();

        console.log(`[Consignment] Registered ${validCodes.length} items to Google Sheets`);
        res.json({ success: true, insertedCount: validCodes.length });

    } catch (err) {
        console.error('[Consignment] Add Error:', err.message);
        res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
    }
});

/**
 * GET /api/admin/consignment
 * 위탁 목록 조회 (products 테이블과 JOIN하여 상품 정보 포함)
 * query: ?status=all|active|sold
 */
app.get('/api/admin/consignment', async (req, res) => {
    const { status = 'all' } = req.query;

    try {
        const auth = await getGoogleSheetsAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        const result = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${CONSIGNMENT_SHEET}!A:H`,
        });

        const rows = result.data.values || [];
        if (rows.length <= 1) {
            return res.json({ items: [] });
        }

        const headers = rows[0]; // ['등록일시', '상품코드', '상태', '판매일시', '커미션율', '커미션금액', '정산금액', '판매차수']
        let items = rows.slice(1).map((row, idx) => {
            const obj = Object.fromEntries(headers.map((h, i) => [h, row[i] || '']));
            return {
                id: idx + 2, // 구글 시트 행 번호 (1-based + header)
                product_code: obj['상품코드'],
                status: obj['상태'],
                registered_at: obj['등록일시'],
                sold_at: obj['판매일시'],
                commission_rate: obj['커미션율'],
                commission_amount: obj['커미션금액'],
                net_amount: obj['정산금액'],
                batch_id: obj['판매차수']
            };
        });

        // [Fix] 'cancelled' 상태인 항목은 기본적으로 모든 뷰에서 제거
        items = items.filter(item => item.status !== 'cancelled');

        // 상태 필터링
        if (status !== 'all') {
            items = items.filter(item => item.status === status);
        }

        // 최신순 정렬
        items.sort((a, b) => (b.registered_at || '').localeCompare(a.registered_at || ''));

        // SQLite DB에서 상품 정보 JOIN
        const codes = [...new Set(items.map(i => i.product_code).filter(Boolean))];
        if (codes.length > 0) {
            const placeholders = codes.map(() => '?').join(',');
            const products = await new Promise((resolve, reject) => {
                db.all(`SELECT code, name, brand, price, thumbnail_url, stock FROM products WHERE code IN (${placeholders})`, codes, (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows || []);
                });
            });
            const pMap = Object.fromEntries(products.map(p => [p.code, p]));
            items = items.map(item => ({
                ...item,
                ...(pMap[item.product_code] || {})
            }));
        }

        res.json({ items });

    } catch (err) {
        console.error('[Consignment] Fetch Error:', err.message);
        res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
    }
});

/**
 * PUT /api/admin/consignment/:id/sold
 * 특정 위탁 아이템을 판매완료 처리
 */
app.put('/api/admin/consignment/:id/sold', async (req, res) => {
    const { id } = req.params; // 행 번호
    const { commissionRate = 0 } = req.body;
    const rowIndex = parseInt(id);

    try {
        const auth = await getGoogleSheetsWriteAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        const soldAt = new Date().toISOString().replace('T', ' ').substring(0, 19);

        // 1. 해당 행의 정보 읽기 (상품코드 파악용)
        const rowRes = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${CONSIGNMENT_SHEET}!A${rowIndex}:B${rowIndex}`,
        });
        const productCode = rowRes.data.values?.[0]?.[1];
        if (!productCode) return res.status(404).json({ error: 'ITEM_NOT_FOUND' });

        // 2. DB에서 상품 가격 조회
        const product = await new Promise((resolve, reject) => {
            db.get('SELECT price FROM products WHERE code = ?', [productCode], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });

        const totalPrice = product ? Number(product.price) : 0;
        const commRate = Number(commissionRate);
        const commAmount = Math.round(totalPrice * (commRate / 100));
        const netAmount = totalPrice - commAmount;

        const batchId = soldAt; // 별도 순번 없이 판매일시를 차수 키로 사용

        // 4. 구글 시트 업데이트 (C열: 상태, D: 판매일시, E: 커미션율, F: 커미션금액, G: 정산금액, H: 판매차수)
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${CONSIGNMENT_SHEET}!C${rowIndex}:H${rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [['sold', soldAt, `${commRate}%`, commAmount, netAmount, batchId]] }
        });

        // 5. 로컬 DB 및 실시간 동기화 추가 (홈페이지 반영 및 재고 차감)
        try {
            // 5-1. products 테이블 품절 처리
            db.run("UPDATE products SET stock = 'Sold Out' WHERE code = ?", [productCode]);
            
            // 5-2. consignment_items 테이블 상태 업데이트
            db.run("UPDATE consignment_items SET status = 'sold', sold_at = ? WHERE product_code = ?", [soldAt, productCode]);

            // 5-3. 사입품목 시트 재고 상태 동기화 (V열에 커미션 제외 금액 기록)
            await syncStockToGoogleSheets([productCode], 'Sold Out', { [productCode]: netAmount });

            // 5-4. 주문내역 시트에 매출 추가 (위탁판매는 커미션 제외 금액으로 기록)
            const consignmentOrderNumber = `CONSIGN-${new Date().toISOString().replace(/[-:T.]/g, '').substring(0, 14)}`;
            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: `${ORDERS_SHEET}!A:L`,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [[
                        consignmentOrderNumber, // A: 주문번호
                        soldAt,                 // B: 주문일시
                        '위탁판매',             // C: 고객명
                        'consignment',          // D: 라인ID
                        '-',                    // E: 전화번호
                        productCode,            // F: 상품코드
                        product?.name || '위탁상품', // G: 상품명
                        product?.brand || '',                // H: 브랜드
                        1,                                   // I: 수량
                        netAmount,                           // J: 금액 (정산 금액)
                        'confirmed',                         // K: 상태
                        'CONSIGN'                            // L: 주소
                    ]]
                }
            });
            console.log(`[Consignment] Successfully synced sold status for ${productCode}`);
        } catch (syncErr) {
            console.error('[Consignment] Sync extra steps error:', syncErr.message);
        }
        
        console.log(`[Consignment] Item at row ${id} marked as sold in batch ${batchId}`);
        res.json({ success: true, id, totalPrice, commAmount, netAmount, batchId });

    } catch (err) {
        console.error('[Consignment] Sold Update Error:', err.message);
        res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
    }
});

/**
 * POST /api/admin/consignment/bulk-sold
 * 여러 위탁 아이템을 한 번에 판매 완료 처리
 */
app.post('/api/admin/consignment/bulk-sold', async (req, res) => {
    const { ids, commissionRate = 0 } = req.body; // ids는 행 번호 배열

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'MISSING_FIELDS' });
    }

    try {
        const auth = await getGoogleSheetsWriteAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        const soldAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const commRate = Number(commissionRate);
        const batchId = soldAt; // 동일 요청 내 모든 항목이 같은 일시(차수) 공유

        const dataUpdates = [];
        const syncItems = []; // 실시간 동기화용 데이터 수집
        
        for (const id of ids) {
            const rowIndex = parseInt(id);
            const rowRes = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${CONSIGNMENT_SHEET}!B${rowIndex}`,
            });
            const productCode = rowRes.data.values?.[0]?.[0];
            
            if (productCode) {
                const product = await new Promise((resolve, reject) => {
                    db.get('SELECT name, brand, price FROM products WHERE code = ?', [productCode], (err, row) => {
                        if (err) return reject(err);
                        resolve(row);
                    });
                });
                const totalPrice = product ? Number(product.price) : 0;
                const commAmount = Math.round(totalPrice * (commRate / 100));
                const netAmount = totalPrice - commAmount;

                dataUpdates.push({
                    range: `${CONSIGNMENT_SHEET}!C${rowIndex}:H${rowIndex}`,
                    values: [['sold', soldAt, `${commRate}%`, commAmount, netAmount, batchId]]
                });

                syncItems.push({
                    code: productCode,
                    name: product?.name || '위탁상품',
                    brand: product?.brand || '',
                    price: totalPrice,
                    netAmount: netAmount
                });
            }
        }

        if (dataUpdates.length > 0) {
            // 1. 위탁제품 시트 업데이트 (Batch)
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data: dataUpdates
                }
            });

            // 2. 로컬 DB 및 실시간 동기화 (Bulk)
            try {
                const codes = syncItems.map(it => it.code);
                const placeholders = codes.map(() => '?').join(',');

                // 2-1. products 테이블 품절 처리
                db.run(`UPDATE products SET stock = 'Sold Out' WHERE code IN (${placeholders})`, codes);
                
                // 2-2. consignment_items 테이블 상태 업데이트
                db.run(`UPDATE consignment_items SET status = 'sold', sold_at = ? WHERE product_code IN (${placeholders})`, [soldAt, ...codes]);

                // 2-3. 사입품목 시트 재고 상태 동기화 (V열에 커미션 제외 금액 기록)
                const consignmentPriceMap = {};
                syncItems.forEach(it => { consignmentPriceMap[it.code] = it.netAmount; });
                await syncStockToGoogleSheets(codes, 'Sold Out', consignmentPriceMap);

                // [Fix] 매출 기록을 ORDERS_SHEET(주문내역)로 통합
                const salesRows = syncItems.map(it => [
                    `CONSIGN-${Date.now()}`, // A: 주문번호
                    soldAt,                 // B: 주문일시
                    '위탁판매',             // C: 고객명
                    'consignment',          // D: 라인ID
                    '-',                    // E: 전화번호
                    it.code,                // F: 상품코드
                    it.name,                // G: 상품명
                    it.brand,               // H: 브랜드
                    1,                      // I: 수량
                    it.netAmount,           // J: 금액
                    'confirmed',            // K: 상태
                    'CONSIGN'               // L: 주소
                ]);

                await sheets.spreadsheets.values.append({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${ORDERS_SHEET}!A:L`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: salesRows }
                });
                
                console.log(`[Consignment] Bulk sync completed for ${codes.length} items to ${ORDERS_SHEET}`);
            } catch (syncErr) {
                console.error('[Consignment] Bulk sync error:', syncErr.message);
            }
        }

        res.json({ success: true, processedCount: dataUpdates.length, batchId });
    } catch (err) {
        console.error('[Consignment] Bulk Sold Error:', err.message);
        res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
    }
});

// DELETE /api/admin/consignment/:id — 특정 위탁 아이템 취소
app.delete('/api/admin/consignment/:id', async (req, res) => {
    const { id } = req.params; // 행 번호
    const rowIndex = parseInt(id);

    try {
        const auth = await getGoogleSheetsWriteAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        // 상태를 'cancelled'로 변경 (행 자체를 삭제하면 행 번호가 꼬이므로 상태값 변경 권장)
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${CONSIGNMENT_SHEET}!C${rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [['cancelled']] }
        });

        console.log(`[Consignment] Item at row ${id} cancelled in Sheets`);
        res.json({ success: true, id });

    } catch (err) {
        console.error('[Consignment] Delete Error:', err.message);
        res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
    }
});

/**
 * POST /api/admin/consignment/bulk-cancel
 * 여러 위탁 아이템을 한 번에 취소 처리 (상태를 'cancelled'로 변경)
 */
app.post('/api/admin/consignment/bulk-cancel', async (req, res) => {
    const { ids } = req.body; // ids는 행 번호 배열

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'MISSING_FIELDS' });
    }

    try {
        const auth = await getGoogleSheetsWriteAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        // 일괄 업데이트를 위해 각 행마다 요청 생성
        const dataUpdates = ids.map(id => {
            const rowIndex = parseInt(id);
            return {
                range: `${CONSIGNMENT_SHEET}!C${rowIndex}`,
                values: [['cancelled']]
            };
        });

        if (dataUpdates.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data: dataUpdates
                }
            });
        }

        console.log(`[Consignment] Bulk cancelled ${dataUpdates.length} items`);
        res.json({ success: true, processedCount: dataUpdates.length });

    } catch (err) {
        console.error('[Consignment] Bulk Cancel Error:', err.message);
        res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
    }
});

// =============================================
// [관리자 전용] 고객관리 API
// 관리자가 직접 고객 정보를 등록/수정/삭제/조회
// =============================================

// GET /api/admin/managed-customers — 전체 고객 목록 조회 (검색 지원)
app.get('/api/admin/managed-customers', (req, res) => {
    const { search = '' } = req.query;
    let query = 'SELECT * FROM managed_customers';
    const params = [];

    // 검색어가 있으면 아이디/전화번호/주소에서 부분 매칭
    if (search.trim()) {
        query += ' WHERE customer_id LIKE ? OR phone LIKE ? OR address LIKE ?';
        const like = `%${search.trim()}%`;
        params.push(like, like, like);
    }
    query += ' ORDER BY updated_at DESC';

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ customers: rows || [] });
    });
});

// GET /api/admin/managed-customers/suggest — 아이디 자동완성 (prefix 매칭 및 휴대번호 검색)
app.get('/api/admin/managed-customers/suggest', (req, res) => {
    const { q = '' } = req.query;
    if (!q.trim()) return res.json({ suggestions: [] });

    // 입력된 문자열로 시작하는 고객 아이디 또는 포함하는 휴대번호를 최대 10개까지 반환
    db.all(
        'SELECT customer_id, phone, address FROM managed_customers WHERE customer_id LIKE ? OR phone LIKE ? ORDER BY customer_id LIMIT 10',
        [`${q.trim()}%`, `%${q.trim()}%`],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ suggestions: rows || [] });
        }
    );
});

// POST /api/admin/managed-customers — 고객 등록
app.post('/api/admin/managed-customers', async (req, res) => {
    const { customer_id, phone = '', address = '' } = req.body;
    if (!customer_id || !customer_id.trim()) {
        return res.status(400).json({ error: 'MISSING_FIELDS', message: '고객 아이디를 입력해주세요.' });
    }

    try {
        const c_id = customer_id.trim();
        const c_phone = phone.trim();
        const c_address = address.trim();
        const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

        // 1. SQLite 저장
        db.run(
            `INSERT INTO managed_customers (customer_id, phone, address, updated_at) VALUES (?, ?, ?, ?)`,
            [c_id, c_phone, c_address, now],
            async function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(409).json({ error: 'DUPLICATE', message: '이미 등록된 아이디입니다.' });
                    }
                    return res.status(500).json({ error: err.message });
                }

                // 2. 구글 시트 동기화 (Append)
                try {
                    const auth = await getGoogleSheetsWriteAuth();
                    const sheets = google.sheets({ version: 'v4', auth });
                    
                    // 시트 존재 여부 확인 및 생성
                    const metaRes = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
                    let sheet = metaRes.data.sheets.find(s => s.properties.title === CUSTOMERS_SHEET);
                    
                    if (!sheet) {
                        console.log(`[Admin] Creating missing sheet: ${CUSTOMERS_SHEET}`);
                        await sheets.spreadsheets.batchUpdate({
                            spreadsheetId: SPREADSHEET_ID,
                            requestBody: {
                                requests: [{
                                    addSheet: { properties: { title: CUSTOMERS_SHEET } }
                                }]
                            }
                        });
                        // 헤더 추가
                        await sheets.spreadsheets.values.update({
                            spreadsheetId: SPREADSHEET_ID,
                            range: `${CUSTOMERS_SHEET}!A1:D1`,
                            valueInputOption: 'USER_ENTERED',
                            requestBody: {
                                values: [['고객 아이디', '전화번호', '주소', '업데이트 일시']]
                            }
                        });
                    }

                    await sheets.spreadsheets.values.append({
                        spreadsheetId: SPREADSHEET_ID,
                        range: `${CUSTOMERS_SHEET}!A:D`,
                        valueInputOption: 'USER_ENTERED',
                        requestBody: {
                            values: [[c_id, c_phone, c_address, now]]
                        }
                    });
                    console.log(`[Admin] Managed customer registered & synced: ${c_id}`);
                } catch (sErr) {
                    console.error('[Admin] Google Sheets Sync Error (Post):', sErr.message);
                }

                res.status(201).json({ success: true, id: this.lastID });
            }
        );
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/admin/managed-customers/:id — 고객 정보 수정
app.put('/api/admin/managed-customers/:id', async (req, res) => {
    const { id } = req.params;
    const { customer_id, phone, address } = req.body;

    if (!customer_id || !customer_id.trim()) {
        return res.status(400).json({ error: 'MISSING_FIELDS', message: '고객 아이디를 입력해주세요.' });
    }

    try {
        const c_id = customer_id.trim();
        const c_phone = (phone || '').trim();
        const c_address = (address || '').trim();
        const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

        // 1. 기존 정보(ID) 조회 (시트에서 행을 찾기 위함)
        const oldCustomer = await new Promise((resolve) => {
            db.get('SELECT customer_id FROM managed_customers WHERE id = ?', [id], (err, row) => resolve(row));
        });

        // 2. SQLite 업데이트
        db.run(
            `UPDATE managed_customers SET customer_id = ?, phone = ?, address = ?, updated_at = ? WHERE id = ?`,
            [c_id, c_phone, c_address, now, id],
            async function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(409).json({ error: 'DUPLICATE', message: '이미 등록된 아이디입니다.' });
                    }
                    return res.status(500).json({ error: err.message });
                }
                if (this.changes === 0) return res.status(404).json({ error: 'NOT_FOUND', message: '고객을 찾을 수 없습니다.' });

                // 3. 구글 시트 동기화 (Find & Update)
                if (oldCustomer) {
                    try {
                        const auth = await getGoogleSheetsWriteAuth();
                        const sheets = google.sheets({ version: 'v4', auth });
                        const sheetRes = await sheets.spreadsheets.values.get({
                            spreadsheetId: SPREADSHEET_ID,
                            range: `${CUSTOMERS_SHEET}!A:A`
                        });
                        const rows = sheetRes.data.values || [];
                        const rowIndex = rows.findIndex(row => String(row[0]).trim() === oldCustomer.customer_id);

                        if (rowIndex !== -1) {
                            await sheets.spreadsheets.values.update({
                                spreadsheetId: SPREADSHEET_ID,
                                range: `${CUSTOMERS_SHEET}!A${rowIndex + 1}:D${rowIndex + 1}`,
                                valueInputOption: 'USER_ENTERED',
                                requestBody: {
                                    values: [[c_id, c_phone, c_address, now]]
                                }
                            });
                            console.log(`[Admin] Managed customer updated & synced: ${c_id}`);
                        }
                    } catch (sErr) {
                        console.error('[Admin] Google Sheets Sync Error (Put):', sErr.message);
                    }
                }

                res.json({ success: true });
            }
        );
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/admin/managed-customers/:id — 고객 삭제
app.delete('/api/admin/managed-customers/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // 1. 기존 정보(ID) 조회 (시트에서 행을 찾기 위함)
        const oldCustomer = await new Promise((resolve) => {
            db.get('SELECT customer_id FROM managed_customers WHERE id = ?', [id], (err, row) => resolve(row));
        });

        // 2. SQLite 삭제
        db.run('DELETE FROM managed_customers WHERE id = ?', [id], async function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'NOT_FOUND', message: '고객을 찾을 수 없습니다.' });

            // 3. 구글 시트 동기화 (Find & Delete row)
            if (oldCustomer) {
                try {
                    const auth = await getGoogleSheetsWriteAuth();
                    const sheets = google.sheets({ version: 'v4', auth });
                    const sheetRes = await sheets.spreadsheets.values.get({
                        spreadsheetId: SPREADSHEET_ID,
                        range: `${CUSTOMERS_SHEET}!A:A`
                    });
                    const rows = sheetRes.data.values || [];
                    const rowIndex = rows.findIndex(row => String(row[0]).trim() === oldCustomer.customer_id);

                    if (rowIndex !== -1) {
                        // 행을 삭제 (Gid 필요)
                        const metaRes = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
                        const sheet = metaRes.data.sheets.find(s => s.properties.title === CUSTOMERS_SHEET);
                        if (sheet) {
                            await sheets.spreadsheets.batchUpdate({
                                spreadsheetId: SPREADSHEET_ID,
                                requestBody: {
                                    requests: [{
                                        deleteDimension: {
                                            range: {
                                                sheetId: sheet.properties.sheetId,
                                                dimension: 'ROWS',
                                                startIndex: rowIndex,
                                                endIndex: rowIndex + 1
                                            }
                                        }
                                    }]
                                }
                            });
                            console.log(`[Admin] Managed customer deleted & synced: ${oldCustomer.customer_id}`);
                        }
                    }
                } catch (sErr) {
                    console.error('[Admin] Google Sheets Sync Error (Delete):', sErr.message);
                }
            }

            res.json({ success: true });
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/admin/managed-customers/:customerId/orders — 특정 고객의 주문 내역 조회
// customer_name(line_id=guest) 기준으로 해당 고객의 모든 주문을 가져옴
app.get('/api/admin/managed-customers/:customerId/orders', (req, res) => {
    const { customerId } = req.params;
    db.all(
        `SELECT * FROM orders WHERE LOWER(customer_name) = LOWER(?) ORDER BY created_at DESC`,
        [customerId],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });

            // items_json 파싱
            const orders = (rows || []).map(order => ({
                ...order,
                items: JSON.parse(order.items_json || '[]')
            }));
            res.json({ orders });
        }
    );
});

// =============================================
// 자체 통계 API
// =============================================
// POST /api/track — 방문 기록 저장
app.post('/api/track', (req, res) => {
    const { path, referrer } = req.body;
    if (!path) return res.status(400).json({ error: 'path is required' });

    // IP나 기타 식별자로 1시간 내 중복 방문 확인
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    db.get(
        `SELECT id FROM page_views 
         WHERE ip_address = ? AND path = ? AND created_at >= datetime('now', '-1 hour', 'localtime')`,
        [ip, path],
        (err, row) => {
            if (err) {
                console.error('[Track] Error checking duplicate:', err.message);
                return res.status(500).json({ error: err.message });
            }
            if (row) {
                return res.json({ success: true, duplicated: true });
            }

            db.run(
                `INSERT INTO page_views (path, referrer, user_agent, ip_address) VALUES (?, ?, ?, ?)`,
                [path, referrer || '', userAgent, ip],
                (err) => {
                    if (err) {
                        console.error('[Track] Insert error:', err.message);
                        return res.status(500).json({ error: err.message });
                    }
                    res.json({ success: true });
                }
            );
        }
    );
});

// GET /api/admin/traffic — 트래픽 통계 조회
app.get('/api/admin/traffic', (req, res) => {
    const todayQuery = `
        SELECT COUNT(DISTINCT ip_address) as todayVisitors, COUNT(*) as todayViews 
        FROM page_views 
        WHERE date(created_at) = date('now', 'localtime')
    `;
    const totalQuery = `
        SELECT COUNT(DISTINCT ip_address) as totalVisitors, COUNT(*) as totalViews 
        FROM page_views
    `;
    const topPagesQuery = `
        SELECT path, COUNT(*) as views 
        FROM page_views 
        WHERE date(created_at) >= date('now', '-7 days', 'localtime')
        GROUP BY path 
        ORDER BY views DESC 
        LIMIT 5
    `;
    const topReferrersQuery = `
        SELECT referrer, COUNT(*) as count 
        FROM page_views 
        WHERE referrer != '' AND date(created_at) >= date('now', '-7 days', 'localtime')
        GROUP BY referrer 
        ORDER BY count DESC 
        LIMIT 5
    `;

    db.get(todayQuery, [], (err, todayStats) => {
        if (err) return res.status(500).json({ error: err.message });
        
        db.get(totalQuery, [], (err, totalStats) => {
            if (err) return res.status(500).json({ error: err.message });

            db.all(topPagesQuery, [], (err, topPages) => {
                if (err) return res.status(500).json({ error: err.message });
                
                db.all(topReferrersQuery, [], (err, topReferrers) => {
                    if (err) return res.status(500).json({ error: err.message });
                    
                    res.json({
                        today: {
                            visitors: todayStats.todayVisitors || 0,
                            views: todayStats.todayViews || 0
                        },
                        total: {
                            visitors: (totalStats.totalVisitors || 0) + trafficBaseline.totalVisitors,
                            views: (totalStats.totalViews || 0) + trafficBaseline.totalViews
                        },
                        topPages: topPages || [],
                        topReferrers: topReferrers || []
                    });
                });
            });
        });
    });
});

// =============================================
// SEO (검색엔진 최적화) 라우트 - sitemap.xml & robots.txt
// =============================================

/**
 * SEO용 상품 정보 조회 (서버 사이드 메타 태그 주입용)
 */
async function getProductForSEO(code) {
    return new Promise((resolve) => {
        db.get('SELECT name, brand, description, thumbnail_url, image_url FROM products WHERE code = ?', [code], (err, row) => {
            if (err) resolve(null);
            resolve(row);
        });
    });
}

// GET /sitemap.xml - 동적 사이트맵 생성 (최신 상품 목록 기반)
app.get('/sitemap.xml', (req, res) => {
    // 판매 중이거나 최근 등록된 상품들을 위주로 가져옵니다 (재고가 있는 상품 우선순위 권장)
    const sql = `
        SELECT code, updated_at 
        FROM products 
        ORDER BY updated_at DESC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('[SEO] Sitemap generation error:', err.message);
            return res.status(500).send('Error generating sitemap');
        }

        const baseUrl = 'https://www.822shop.com';
        let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>${baseUrl}/</loc>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>
    <url>
        <loc>${baseUrl}/sale</loc>
        <changefreq>daily</changefreq>
        <priority>0.9</priority>
    </url>
    <url>
        <loc>${baseUrl}/notice</loc>
        <changefreq>weekly</changefreq>
        <priority>0.5</priority>
    </url>`;

        // 각 상품 페이지 URL 추가
        rows.forEach(product => {
            if (product.code) {
                // 날짜 포맷 (YYYY-MM-DD)
                let lastmod = new Date().toISOString().split('T')[0];
                if (product.updated_at) {
                    try {
                        lastmod = new Date(product.updated_at).toISOString().split('T')[0];
                    } catch (e) {
                        // 기본값 유지
                    }
                }
                
                xml += `
    <url>
        <loc>${baseUrl}/product/${product.code}</loc>
        <lastmod>${lastmod}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.8</priority>
    </url>`;
            }
        });

        xml += `\n</urlset>`;

        res.header('Content-Type', 'application/xml');
        res.send(xml);
    });
});



// GET /robots.txt - 크롤러 접근 정책 및 사이트맵 위치
app.get('/robots.txt', (req, res) => {
    const robotsTxt = `User-agent: *
Allow: /

Sitemap: https://www.822shop.com/sitemap.xml
`;
    res.header('Content-Type', 'text/plain');
    res.send(robotsTxt);
});

// 관리자: 쿠폰 목록 조회
app.get('/api/admin/coupons', (req, res) => {
    db.all(`SELECT * FROM coupons ORDER BY created_at DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ coupons: rows || [] });
    });
});

// 관리자: 쿠폰 생성
app.post('/api/admin/coupons/generate', async (req, res) => {
    const { type, value, count } = req.body;
    if (!type || !value || !count) return res.status(400).json({ error: 'MISSING_FIELDS' });

    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 1);
    const expiresAtStr = expiresAt.toISOString().split('T')[0];

    const generated = [];
    const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    try {
        const auth = await getGoogleSheetsWriteAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        try {
            await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${COUPONS_SHEET}!A1` });
        } catch (e) {
            if (e.message.includes('range') || e.code === 400) {
                console.log(`[Sync] ${COUPONS_SHEET} 시트가 없어 새로 생성합니다...`);
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    requestBody: {
                        requests: [{ addSheet: { properties: { title: COUPONS_SHEET } } }]
                    }
                });
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${COUPONS_SHEET}!A1:G1`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [['쿠폰번호', '종류', '혜택', '만료일', '사용여부', '사용일시', '주문번호']] }
                });
            }
        }

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            const stmt = db.prepare(`INSERT INTO coupons (code, type, value, expires_at) VALUES (?, ?, ?, ?)`);

            for (let i = 0; i < count; i++) {
                let code = '';
                for (let j = 0; j < 10; j++) code += characters.charAt(Math.floor(Math.random() * characters.length));
                
                stmt.run([code, type, value, expiresAtStr]);
                generated.push([
                    code, 
                    type === 'rate' ? '할인율(%)' : '할인금액(Baht)', 
                    value, 
                    expiresAtStr, 
                    '미사용', 
                    '', 
                    ''
                ]);
            }
            stmt.finalize();
            db.run("COMMIT", async (err) => {
                if (err) return res.status(500).json({ error: err.message });
                
                try {
                    await sheets.spreadsheets.values.append({
                        spreadsheetId: SPREADSHEET_ID,
                        range: `${COUPONS_SHEET}!A:G`,
                        valueInputOption: 'USER_ENTERED',
                        requestBody: { values: generated }
                    });
                } catch (sheetErr) {
                    console.error('[Admin] Coupons sheet sync error:', sheetErr.message);
                }

                res.json({ success: true, count: generated.length });
            });
        });
    } catch (err) {
        console.error('[Admin] Coupon generation error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// 관리자: 쿠폰 삭제
app.delete('/api/admin/coupons/:code', (req, res) => {
    const { code } = req.params;
    db.run('DELETE FROM coupons WHERE code = ?', [code], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'NOT_FOUND', message: '쿠폰을 찾을 수 없습니다.' });
        res.json({ success: true, message: '쿠폰이 삭제되었습니다.' });
    });
});

// 고객: 쿠폰 검증
app.get('/api/coupons/validate/:code', (req, res) => {
    const { code } = req.params;
    db.get(`SELECT * FROM coupons WHERE code = ?`, [code.trim().toUpperCase()], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'INVALID_COUPON', message: '유효하지 않은 쿠폰입니다.' });
        
        if (row.is_used) {
            return res.status(400).json({ error: 'ALREADY_USED', message: '이미 사용한 쿠폰입니다.' });
        }
        
        const today = new Date().toISOString().split('T')[0];
        if (row.expires_at < today) {
            return res.status(400).json({ error: 'EXPIRED', message: '만료된 쿠폰입니다.' });
        }
        
        res.json({ success: true, coupon: row });
    });
});


// =============================================
// [이식] Dream Studio VTG에서 가져온 추가 API 엔드포인트들
// =============================================

// ─── 브랜드 카테고리 매핑 (brands/categorized API용) ───
const CATEGORY_MAPPINGS = {
    '하이패션/럭셔리': ['Dior', 'Gucci', 'Prada', 'Lanvin', 'Burberry', 'Chanel', 'Louis Vuitton', 'Hermes', 'Celine', 'Balenciaga', 'Saint Laurent', 'YSL', 'Givenchy', 'Fendi', 'Bottega Veneta', 'Miu Miu', 'Valentino', 'Loewe', 'Versace', 'Giorgio Armani', 'Armani', 'Tom Ford', 'Bvlgari', 'Cartier', 'Rolex', 'Ferragamo', 'MCM', 'Alexander McQueen', 'Balmain', 'Christian Louboutin', 'Goyard', 'Kenzo', 'Armani Jeans', 'Coach', 'Emporio Armani', 'Ih Nom Uh Nit Paris', 'Moncler', 'Moose Knuckles', 'Tory Burch', 'Vetements'],
    '해외 브랜드': ['Polo Ralph Lauren', 'Polo', 'Ralph Lauren', 'Tommy Hilfiger', 'Lacoste', 'Levi\'s', 'Levis', 'Carhartt', 'Carhartt WIP', 'Stussy', 'Champion', 'Supreme', 'Obey', 'Vans', 'Converse', 'Timberland', 'Diesel', 'Calvin Klein', 'CK', 'Guess', 'HUF', 'Dickies', 'Lee', 'Wrangler', 'Abercrombie & Fitch', 'Hollister', 'American Eagle', 'Nautica', 'L.L.Bean', 'Brooks Brothers', 'Fred Perry', 'Paul Smith', 'Vivienne Westwood', 'Gant', 'Allsaints', 'Calvin Klein Jeans', 'Dkny', 'Jeep', 'Kodak', 'Pretty Green', 'Saint James', 'U.S. Polo Assn.', 'Zadig & Voltaire'],
    '백화점 클래식': ['Daks', 'Hazzys', 'Beanpole', 'Galaxy', 'Maestro', 'Cambridge Members', 'Rogatis', 'Jill Stuart', 'Time', 'System', 'Solid Homme', 'Series', 'Customellow', 'TNGT', 'Mind Bridge', 'ZIOZIA', 'AndZ', 'Trugen', 'Basso', 'Sieg', 'Renoma', 'Pierre Cardin', 'Kinloch', 'Epot', 'Bean Pole', 'Bon Construction', 'Indian Casual', 'Intermezzo'],
    '디자이너 브랜드': ['COMME des GARCONS', 'Maison Margiela', 'Margiela', 'Stone Island', 'C.P. Company', 'A.P.C.', 'Ami', 'Marni', 'Lemaire', 'Acne Studios', 'Jil Sander', 'Off-White', 'Rick Owens', 'Thom Browne', 'JW Anderson', 'Jacquemus', 'Alexander Wang', 'Kiko Kostadinov', 'Martine Rose', 'Raf Simons', 'Dries Van Noten', 'Ann Demeulemeester', 'Helmut Lang', 'Fear of God', 'Essentials', 'OAMC', 'Juun.J', 'Wooyoungmi', 'Solid Homme', 'Acmé De La Vie Adlv', 'Adererror', 'Ape The Great', 'Brownbreath', 'Comme Des Garçons Play', 'Dope', 'Emis', 'Iab Studio', 'Kirsh', 'Lifework', 'Maison Kitsuné', 'Mardi Mercredi', 'Marithé François Girbaud', 'Mark Gonzales', 'Matin Kim', 'Msgm', 'Nerdy', 'O!O!Icollection', 'Play Comme Des Garçons', 'R.A.T C.R.W', 'Sculptor', 'Thisisneverthat', 'What It Isnt'],
    'SPA/베이직': ['ZARA', 'UNIQLO', 'COS', 'H&M', 'Massimo Dutti', 'MUJI', 'Spao', '8seconds', 'Topten', 'Topten10', 'Giordano', 'GU', 'Mango', 'Forever 21', 'Bershka', 'Pull&Bear', 'Oysho', 'Tomboy', 'Studio Tomboy', 'Aland', 'Alice Martha', 'Bluemaru&Co', 'Disney | Ask', 'Fluke', 'I Will Stage', 'Iter', 'Moss', 'Red Is Bad'],
    '스포츠/아웃도어': ['Nike', 'Jordan', 'Air Jordan', 'Adidas', 'The North Face', 'Patagonia', 'Columbia', 'Puma', 'Reebok', 'New Balance', 'Arc\'teryx', 'Asics', 'Under Armour', 'Salomon', 'Snow Peak', 'National Geographic', 'Discovery', 'Discovery Expedition', 'Fila', 'Descente', 'Oakley', 'Mizuno', 'Umbro', 'Kappa', 'K-Swiss', 'Lecoq Sportif', 'Montbell', 'K2', 'Black Yak', 'Nepaa', 'Kolon Sport', 'Helinox', 'Gregory', 'Osprey', 'Mystery Ranch', 'Keen', 'Teva', 'Chaco', 'Vibram', 'NBA', 'MLB', 'Blackyak', 'Chicago Bulls', 'Dynafit', 'Friends Of Soccer', 'Le Coq Sportif', 'Maxler', 'Nepa', 'New Era', 'New York Yankees', 'Tottenham Hotspur'],
    '일본 빈티지/구제': ['Needles', 'Yohji Yamamoto', 'Issey Miyake', 'Kapital', 'Undercover', 'Visvim', 'Wtaps', 'Neighborhood', 'Beams', 'Engineered Garments', 'South2 West8', 'Number (N)ine', 'BAPE', 'A Bathing Ape', 'Hysteric Glamour', 'Evisu', 'Sacai', 'Kolor', 'Junya Watanabe', 'Porter', 'Yoshida Porter', 'Snow Peak', 'OrSlow', 'Studio D\'Artisan', 'Samurai Jeans', 'Momotaro Jeans', 'Iron Heart', 'Pure Blue Japan', 'AURALEE', 'Comoli', 'Graphpaper'],
    '골프웨어': ['Titleist', 'PXG', 'Pearly Gates', 'Volvik', 'Callaway', 'TaylorMade', 'J.Lindeberg', 'Mark&Lona', 'FootJoy', 'Ping', 'Cleveland', 'Descente Golf', 'Nike Golf', 'Adidas Golf', 'Puma Golf', 'Under Armour Golf', 'Mizuno Golf', 'Honma', 'Majesty', 'Castelbajac', 'Louis Lavie', 'WAAC', 'G/FORE', 'Malbon Golf', 'Bogner', 'Mark & Lona']
};

// ─── 1. 브랜드 카테고리별 분류 API ───
app.get('/api/brands/categorized', async (req, res) => {
    try {
        const cache = await getBrandCache();
        const allBrands = cache.allBrands;
        
        // 카테고리별로 브랜드 담기
        const categorized = {
            '하이패션/럭셔리': [],
            '해외 브랜드': [],
            '백화점 클래식': [],
            '디자이너 브랜드': [],
            'SPA/베이직': [],
            '스포츠/아웃도어': [],
            '일본 빈티지/구제': [],
            '골프웨어': [],
            '기타': []
        };
        
        // 매핑 로직
        allBrands.forEach(brand => {
            let matchedCategory = '기타';
            for (const [catName, brandList] of Object.entries(CATEGORY_MAPPINGS)) {
                if (brandList.some(b => brand.toLowerCase() === b.toLowerCase())) {
                    matchedCategory = catName;
                    break;
                }
            }
            categorized[matchedCategory].push(brand);
        });

        res.json({ success: true, categorized, topBrands: cache.topBrands });
    } catch (err) {
        console.error('Categorized brands error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── 2. 홈 화면 테마 API ───
app.get('/api/recommended_brands', (req, res) => {
    db.all('SELECT * FROM recommended_brands ORDER BY sort_order ASC, id DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB Error', message: err.message });
        res.json({ success: true, brands: rows });
    });
});

app.post('/api/admin/recommended_brands', (req, res) => {
    const { group_name, brand_name, description_kr, description_en, description_th, hero_image_url, logo_url, sort_order } = req.body;
    if (!group_name || !brand_name) return res.status(400).json({ error: 'BAD_REQUEST', message: '그룹명과 브랜드명은 필수입니다.' });

    db.run(
        'INSERT INTO recommended_brands (group_name, brand_name, description_kr, description_en, description_th, hero_image_url, logo_url, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [group_name, brand_name, description_kr || '', description_en || '', description_th || '', hero_image_url || '', logo_url || '', sort_order || 0],
        function(err) {
            if (err) return res.status(500).json({ error: 'DB Error', message: err.message });
            res.json({ success: true, id: this.lastID });
        }
    );
});

app.put('/api/admin/recommended_brands/:id', (req, res) => {
    const { id } = req.params;
    const { group_name, brand_name, description_kr, description_en, description_th, hero_image_url, logo_url, sort_order } = req.body;
    
    db.run(
        'UPDATE recommended_brands SET group_name=?, brand_name=?, description_kr=?, description_en=?, description_th=?, hero_image_url=?, logo_url=?, sort_order=? WHERE id=?',
        [group_name, brand_name, description_kr || '', description_en || '', description_th || '', hero_image_url || '', logo_url || '', sort_order || 0, id],
        function(err) {
            if (err) return res.status(500).json({ error: 'DB Error', message: err.message });
            res.json({ success: true, changes: this.changes });
        }
    );
});

app.delete('/api/admin/recommended_brands/:id', (req, res) => {
    const { id } = req.params;
    db.run('DELETE FROM recommended_brands WHERE id=?', [id], function(err) {
        if (err) return res.status(500).json({ error: 'DB Error', message: err.message });
        res.json({ success: true, changes: this.changes });
    });
});

// ─── END 추천 브랜드 API ───

app.get('/api/themes', (req, res) => {
    db.all('SELECT * FROM home_themes ORDER BY sort_order ASC, created_at DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB Error', message: err.message });
        res.json({ success: true, themes: rows });
    });
});

// 관리자: 테마 추가
app.post('/api/admin/themes', (req, res) => {
    const { title, filter_gender, filter_upper_category, filter_category, filter_brand, filter_season, sort_order, filter_mode, max_items } = req.body;
    if (!title) return res.status(400).json({ error: 'BAD_REQUEST', message: '제목은 필수입니다.' });

    db.run(
        'INSERT INTO home_themes (title, filter_gender, filter_upper_category, filter_category, filter_brand, filter_season, sort_order, filter_mode, max_items) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [title, filter_gender || '', filter_upper_category || '', filter_category || '', filter_brand || '', filter_season || '', sort_order || 0, filter_mode || 'filter', parseInt(max_items) || 10],
        function(err) {
            if (err) return res.status(500).json({ error: 'DB Error', message: err.message });
            res.json({ success: true, id: this.lastID });
        }
    );
});

// 관리자: 테마 수정
app.put('/api/admin/themes/:id', (req, res) => {
    const { id } = req.params;
    const { title, filter_gender, filter_upper_category, filter_category, filter_brand, filter_season, sort_order, filter_mode, max_items } = req.body;

    db.run(
        'UPDATE home_themes SET title = ?, filter_gender = ?, filter_upper_category = ?, filter_category = ?, filter_brand = ?, filter_season = ?, sort_order = ?, filter_mode = ?, max_items = ? WHERE id = ?',
        [title, filter_gender || '', filter_upper_category || '', filter_category || '', filter_brand || '', filter_season || '', sort_order || 0, filter_mode || 'filter', parseInt(max_items) || 10, id],
        function(err) {
            if (err) return res.status(500).json({ error: 'DB Error', message: err.message });
            res.json({ success: true });
        }
    );
});

// 관리자: 테마 삭제
app.delete('/api/admin/themes/:id', (req, res) => {
    const { id } = req.params;
    db.run('DELETE FROM home_themes WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: 'DB Error', message: err.message });
        res.json({ success: true });
    });
});

// ─── 3. 메인 배너 캐러셀 API ───

// Multer 설정 (배너 이미지 업로드용)
const bannerStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        // dbPath에 따라 설정된 영구 스토리지 경로 사용
        cb(null, persistentUploadsPath);
    },
    filename: (req, file, cb) => {
        // 한글 파일명이나 특수문자로 인한 오류 방지를 위해 고유 이름 생성
        const ext = path.extname(file.originalname);
        cb(null, `img-${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`);
    }
});
const uploadBanner = multer({ storage: bannerStorage });

// 관리자: 배너 이미지 업로드
app.post('/api/admin/upload_banner', uploadBanner.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: '파일이 업로드되지 않았습니다.' });
    }
    const imageUrl = `/static/main_images/${req.file.filename}`;
    res.json({ success: true, imageUrl });
});

// 모든 메인 배너 가져오기 (사용자 화면용)
app.get('/api/main_banners', (req, res) => {
    db.all('SELECT * FROM main_banners ORDER BY sort_order ASC, created_at DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB Error', message: err.message });
        res.json({ success: true, banners: rows });
    });
});

// 관리자: 배너 추가
app.post('/api/admin/main_banners', (req, res) => {
    const { image_url, link_url, title, subtitle, sort_order } = req.body;
    if (!image_url) return res.status(400).json({ error: 'BAD_REQUEST', message: '이미지 URL은 필수입니다.' });

    db.run(
        'INSERT INTO main_banners (image_url, link_url, title, subtitle, sort_order) VALUES (?, ?, ?, ?, ?)',
        [image_url, link_url || '', title || '', subtitle || '', sort_order || 0],
        function(err) {
            if (err) return res.status(500).json({ error: 'DB Error', message: err.message });
            res.json({ success: true, id: this.lastID });
        }
    );
});

// 관리자: 배너 삭제
app.delete('/api/admin/main_banners/:id', (req, res) => {
    const { id } = req.params;
    db.run('DELETE FROM main_banners WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: 'DB Error', message: err.message });
        res.json({ success: true });
    });
});

// 관리자: 배너 자동 생성
app.post('/api/admin/generate-banner', (req, res) => {
    const { target_date } = req.body;
    if (!target_date) return res.status(400).json({ error: 'BAD_REQUEST', message: '날짜를 입력해주세요 (예: 9/1)' });
    
    const scriptPath = path.resolve(__dirname, '../../create_banner.py');
    
    exec(`python "${scriptPath}" "${target_date}"`, (error, stdout, stderr) => {
        if (error) {
            console.error('배너 생성 스크립트 실행 오류:', error.message);
            return res.status(500).json({ error: 'EXEC_ERROR', message: error.message });
        }
        
        const safe_date = target_date.replace(/\//g, '_');
        const finalUrl = `/assets/banners/banner_${safe_date}.png`;
        
        res.json({ success: true, image_url: finalUrl, title: `${target_date} 입고 예정`, stdout });
    });
});

// ─── 4. 카테고리 이미지 API ───
app.get('/api/category-images', (req, res) => {
    const query = `
        SELECT upper_category, thumbnail_url, image_url, product_images, MAX(CAST(REPLACE(REPLACE(price, ',', ''), '원', '') AS INTEGER)) as max_price
        FROM products 
        WHERE LOWER(COALESCE(CAST(stock AS TEXT), '')) NOT LIKE '%sold%' AND LOWER(COALESCE(CAST(stock AS TEXT), '')) NOT LIKE '%out%'
        GROUP BY upper_category
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB Error', message: err.message });
        
        const images = {};
        rows.forEach(row => {
            let selectedImage = row.thumbnail_url || row.image_url;
            
            // 누끼딴 이미지(main)가 배열에 있으면 최우선으로 사용
            if (row.product_images) {
                try {
                    const parsed = JSON.parse(row.product_images);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        const mainImg = parsed.find(img => img.includes('main'));
                        selectedImage = mainImg || parsed[0];
                    }
                } catch(e) {
                    console.error("Error parsing product_images in category-images", e);
                }
            }

            if (row.upper_category && selectedImage) {
                const u = row.upper_category.trim();
                if (!images[u]) {
                    images[u] = selectedImage;
                }
            }
        });
        res.json({ success: true, images });
    });
});

// ─── 5. 찜하기(Wishlist) API ───
// [중요] catch-all 라우트보다 반드시 위에 선언해야 Express가 올바르게 라우팅함
app.post('/api/wishlist/toggle', (req, res) => {
    const { customerId, productCode } = req.body;
    if (!customerId || !productCode) return res.status(400).json({ error: 'MISSING_FIELDS' });

    db.get('SELECT id FROM wishlists WHERE customer_id = ? AND product_code = ?', [customerId, productCode], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });

        if (row) {
            db.run('DELETE FROM wishlists WHERE id = ?', [row.id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, isWished: false });
            });
        } else {
            db.run('INSERT INTO wishlists (customer_id, product_code) VALUES (?, ?)', [customerId, productCode], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, isWished: true });
            });
        }
    });
});

app.get('/api/wishlist/:customerId', (req, res) => {
    const { customerId } = req.params;
    const query = `
        SELECT p.* 
        FROM products p
        JOIN wishlists w ON p.code = w.product_code
        WHERE w.customer_id = ?
        ORDER BY w.created_at DESC
    `;
    db.all(query, [customerId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, wishlist: rows });
    });
});

// ─── 6. 가입 회원(customers) 관리 API (Admin 전용) ───
// [중요] catch-all 라우트보다 반드시 위에 선언
app.get('/api/admin/registered-customers', (req, res) => {
    const { search = '' } = req.query;
    let query = 'SELECT id, login_id, name, phone, address_kr, postal_code, address_detail, created_at, role FROM customers';
    const params = [];

    if (search.trim()) {
        query += ' WHERE login_id LIKE ? OR name LIKE ? OR phone LIKE ?';
        const like = `%${search.trim()}%`;
        params.push(like, like, like);
    }
    query += ' ORDER BY id DESC';

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, customers: rows });
    });
});

app.put('/api/admin/registered-customers/:id', (req, res) => {
    const { id } = req.params;
    const { name, phone, address_kr, postal_code, address_detail, role } = req.body;
    
    // 전화번호 숫자만 필터링
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');

    const query = `
        UPDATE customers 
        SET name = ?, phone = ?, address_kr = ?, postal_code = ?, address_detail = ?, role = ?
        WHERE id = ?
    `;
    db.run(query, [name, cleanPhone, address_kr, postal_code, address_detail, role, id], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE')) {
                return res.status(409).json({ error: 'DUPLICATE_PHONE', message: '전화번호가 중복됩니다.' });
            }
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true });
    });
});

// [진단용] wishlists 테이블 이중 생성 (DB 초기화 이슈 대응)
app.get('/api/force-create', (req, res) => {
    db.run(`
        CREATE TABLE IF NOT EXISTS wishlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            product_code TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            UNIQUE(customer_id, product_code)
        )
    `, (err) => {
        if (err) res.json({ error: err.message });
        else res.json({ success: true });
    });
});


// Catch-all route for React SPA - MUST BE AFTER API ROUTES
app.use(async (req, res) => {
    // API 경로에 대해서는 index.html을 반환하지 않음
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found (V4.2)' });
    }

    const indexPath = path.join(CLIENT_DIST_PATH, 'index.html');
    
    try {
        if (!fs.existsSync(indexPath)) {
            return res.status(404).send(`<h1>Frontend Build Missing</h1><p>Path: ${indexPath}</p>`);
        }

        // [SEO] 상품 상세 페이지인 경우 메타 태그 동적 주입
        if (req.path.startsWith('/product/')) {
            const code = req.path.split('/')[2]?.split('?')[0];
            if (code) {
                const product = await getProductForSEO(code);
                if (product) {
                    let html = fs.readFileSync(indexPath, 'utf8');
                    const title = `[${product.brand}] ${product.name} - 822shop vintage`;
                    const thaiDesc = String(product.description || '').split('(', 2)[0]?.trim();
                    const description = `${product.brand} ${product.name}: ${thaiDesc}`;
                    const image = product.thumbnail_url || product.image_url || 'https://www.822shop.com/822logo_final_v2.png';
                    const url = `https://www.822shop.com/product/${code}`;

                    // HTML 내의 메타 태그 교체
                    html = html.replace(/<title>.*?<\/title>/, `<title>${title}</title>`);
                    html = html.replace(/<meta name="description" content=".*?" \/>/, `<meta name="description" content="${description}" />`);
                    
                    // Open Graph 교체 (index.html에 정의된 순서와 형식을 따름)
                    html = html.replace(/<meta property="og:title" content=".*?" \/>/, `<meta property="og:title" content="${title}" />`);
                    html = html.replace(/<meta property="og:description" content=".*?" \/>/, `<meta property="og:description" content="${description}" />`);
                    html = html.replace(/<meta property="og:image" content=".*?" \/>/, `<meta property="og:image" content="${image}" />`);
                    html = html.replace(/<meta property="og:url" content=".*?" \/>/, `<meta property="og:url" content="${url}" />`);
                    
                    return res.send(html);
                }
            }
        }

        // 일반 페이지는 기존 방식대로 전송
        res.sendFile(indexPath);
    } catch (err) {
        console.error('[SEO] Meta Injection Error:', err.message);
        res.sendFile(indexPath);
    }
});

// =============================================
// 쿠폰 (Coupon) API
// =============================================

// [New] 주문 취소 시 구글 시트 '쿠폰관리' 탭에서 쿠폰을 '사용가능'으로 상태 복원
async function syncCouponRestoreToSheet(code) {
    try {
        const auth = await getGoogleSheetsWriteAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${COUPONS_SHEET}!A:G` });
        const rows = res.data.values || [];
        const rowIndex = rows.findIndex(row => row[0] === code);
        
        if (rowIndex > -1) {
            const rowNum = rowIndex + 1;
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${COUPONS_SHEET}!E${rowNum}:G${rowNum}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [['사용가능', '', '']] }
            });
            console.log(`[Coupon Restore] Google Sheets synced for coupon ${code}`);
        }
    } catch (err) {
        console.error('[Order] Google Sheets coupon restore sync error:', err.message);
    }
}

async function syncCouponUsageToSheet(code, orderNumber, usedAt) {
    try {
        const auth = await getGoogleSheetsWriteAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${COUPONS_SHEET}!A:G` });
        const rows = res.data.values || [];
        const rowIndex = rows.findIndex(row => row[0] === code);
        
        if (rowIndex > -1) {
            const rowNum = rowIndex + 1;
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${COUPONS_SHEET}!E${rowNum}:G${rowNum}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [['사용완료', usedAt, orderNumber]] }
            });
        }
    } catch (err) {
        console.error('[Order] Google Sheets coupon sync error:', err.message);
    }
}

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
