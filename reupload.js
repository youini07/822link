const fs = require('fs');
const { google } = require('googleapis');
const path = require('path');

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets'
];

function parseSpreadsheetId(url) {
  if (!url) return '';
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) return match[1];
  return url.trim();
}

function extractDriveId(url) {
  if (!url) return '';
  const match = url.match(/id=([a-zA-Z0-9-_]+)/);
  return match ? match[1] : '';
}

async function run() {
  try {
    const credsStr = fs.readFileSync('../client_secret.json', 'utf8');
    const credentials = JSON.parse(credsStr);
    const { client_secret, client_id } = credentials.installed || credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, 'http://localhost');

    const tokenStr = fs.readFileSync('../token.json', 'utf8');
    oAuth2Client.setCredentials(JSON.parse(tokenStr));

    const drive = google.drive({ version: 'v3', auth: oAuth2Client });
    const sheets = google.sheets({ version: 'v4', auth: oAuth2Client });

    // config에서 시트 URL 가져오기
    const configPath = 'C:\\Users\\youin\\AppData\\Roaming\\822-link\\config.json';
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const spreadsheetUrls = [
      config.googleSpreadsheetUrl_822shop,
      config.googleSpreadsheetUrl_dreamstudio
    ];

    const codesToUpdate = ['1851', '1854', '1855', '1865', '1867', '1868'];
    const codesRemaining = new Set(codesToUpdate);

    for (const sheetUrl of spreadsheetUrls) {
      if (!sheetUrl) continue;
      if (codesRemaining.size === 0) break;

      const spreadsheetId = parseSpreadsheetId(sheetUrl);
      console.log(`Checking spreadsheet: ${spreadsheetId}`);

      const sheetInfo = await sheets.spreadsheets.get({ spreadsheetId });
      const sheetName = sheetInfo.data.sheets[0].properties.title;

      const sheetData = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!A:W`
      });

      const rows = sheetData.data.values;
      if (!rows) continue;

      for (const row of rows) {
        const prodCode = row[0];
        if (codesRemaining.has(prodCode)) {
          const nukkiUrl = row[21]; // V열
          const synthUrl = row[22]; // W열

          const nukkiId = extractDriveId(nukkiUrl);
          const synthId = extractDriveId(synthUrl);

          console.log(`Found code ${prodCode}, Nukki ID: ${nukkiId}, Synth ID: ${synthId}`);

          // Update Nukki
          if (nukkiId) {
            const localNukkiPath = path.join('..', 'static', 'images', prodCode, `main${prodCode}.jpg`);
            if (fs.existsSync(localNukkiPath)) {
              console.log(`Uploading new Nukki for ${prodCode}...`);
              await drive.files.update({
                fileId: nukkiId,
                media: {
                  mimeType: 'image/jpeg',
                  body: fs.createReadStream(localNukkiPath)
                }
              });
              console.log(`Updated Nukki for ${prodCode}`);
            }
          }

          // Update Synth
          if (synthId) {
            const localSynthPath = path.join('..', 'static', 'images', 'Composites', `${prodCode}.jpg`);
            if (fs.existsSync(localSynthPath)) {
              console.log(`Uploading new Composite for ${prodCode}...`);
              await drive.files.update({
                fileId: synthId,
                media: {
                  mimeType: 'image/jpeg',
                  body: fs.createReadStream(localSynthPath)
                }
              });
              console.log(`Updated Composite for ${prodCode}`);
            }
          }

          codesRemaining.delete(prodCode);
        }
      }
    }

    console.log('All updates finished.');
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
