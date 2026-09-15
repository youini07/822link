import { useState, useEffect } from 'react';
import { getTranslation } from '../services/i18n';
import { fetchShipping } from '../services/api';

const ShipTracker = ({ lang }) => {
    const [schedule, setSchedule] = useState([]);
    const [loading, setLoading] = useState(true);

    // 항로 기항지 정의 (좌=방콕, 우=인천)
    const stations = [
        { name: "INCHEON", x_pct: 93 },
        { name: "BUSAN", x_pct: 80 },
        { name: "SHANGHAI", x_pct: 65 },
        { name: "HONG KONG", x_pct: 48 },
        { name: "HO CHI MINH", x_pct: 28 },
        { name: "BANGKOK", x_pct: 7 },
    ];

    const tTitle = getTranslation(lang, 'ship_tracker_title');
    const tArrives = getTranslation(lang, 'arrives');

    useEffect(() => {
        // Google Sheets '배송' 탭에서 실제 도착 예정일을 가져옴
        const fetchShippingData = async () => {
            setLoading(true);
            try {
                const data = await fetchShipping();
                const arrivalDates = data.arrivalDates || [];

                // 도착 예정일이 없으면 빈 스케줄
                if (arrivalDates.length === 0) {
                    setSchedule([]);
                    setLoading(false);
                    return;
                }

                const colors = ["#e84040", "#3a7bd5", "#f5a623", "#27ae60"];

                const parsed = arrivalDates
                    .map((dateStr, idx) => {
                        try {
                            if (!dateStr || dateStr.toLowerCase() === 'tbd' || dateStr.toLowerCase() === 'nan') return null;

                            let arrival;
                            // "3/13" 처럼 연도가 없는 경우 처리
                            if (dateStr.includes('/') && dateStr.split('/').length === 2) {
                                const [m, d] = dateStr.split('/').map(Number);
                                arrival = new Date(new Date().getFullYear(), m - 1, d);
                            } else {
                                arrival = new Date(dateStr);
                            }

                            if (isNaN(arrival.getTime())) return null;

                            // 출발일 = 도착일 - 21일 (인천→방콕 해상 운송 소요 기간)
                            const departure = new Date(arrival.getTime() - 21 * 24 * 60 * 60 * 1000);
                            const m = arrival.getMonth() + 1;
                            const d = arrival.getDate();
                            const label = lang === 'KR'
                                ? `${m}/${d} ${tArrives}`
                                : `${tArrives} ${m}/${d}`;

                            return {
                                start: departure,
                                end: arrival,
                                label,
                                color: colors[idx % colors.length]
                            };
                        } catch {
                            return null;
                        }
                    })
                    .filter(Boolean)
                    // 도착일 오름차순 정렬
                    .sort((a, b) => a.end.getTime() - b.end.getTime());

                setSchedule(parsed);
            } catch (err) {
                console.error('[ShipTracker] API 호출 실패:', err);
                setSchedule([]);
            }
            setLoading(false);
        };

        fetchShippingData();
    }, [lang, tArrives]);

    const calcProgress = (sch) => {
        const now = new Date();
        const total = sch.end.getTime() - sch.start.getTime();
        const elapsed = now.getTime() - sch.start.getTime();
        if (total <= 0) return 0;
        const p = elapsed / total;
        return Math.max(0, Math.min(1, p));
    };

    // 데이터가 없거나 모든 배송이 도착 완료된 경우 컴포넌트 숨김
    const now = new Date();
    const activeSchedules = schedule.filter(sch => now <= sch.end);
    if (!loading && activeSchedules.length === 0) return null;

    return (
        <div className="w-full bg-white border border-border p-6 rounded-lg mb-8 shadow-sm">
            <h2 className="text-xl font-bold text-center mb-8 tracking-wide text-gray-800">{tTitle}</h2>

            {loading ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                    {getTranslation(lang, 'loading')}
                </div>
            ) : (
                <div className="relative w-full h-[100px] mt-10">
                    {/* 메인 트래킹 라인 */}
                    <div className="absolute top-[30px] left-[5%] w-[90%] h-[4px] bg-gray-200 rounded-full"></div>

                    {/* 기항지 노드 */}
                    {stations.map((st) => (
                        <div
                            key={st.name}
                            className="absolute flex flex-col items-center justify-center transform -translate-x-1/2"
                            style={{ left: `${st.x_pct}%`, top: '15px' }}
                        >
                            <div className="w-3 h-3 rounded-full bg-gray-400 z-10 border-2 border-white"></div>
                            <div className="mt-4 text-[10px] sm:text-xs font-bold text-gray-500 text-center uppercase tracking-widest break-words w-16">
                                {st.name}
                            </div>
                        </div>
                    ))}

                    {/* 선박 위치 표시 */}
                    {schedule.map((sch, i) => {
                        try {
                            const now = new Date();
                            if (!sch || !sch.end || !sch.start || now > sch.end) return null;

                            const prog = calcProgress(sch);
                            const startX = 93;
                            const endX = 7;
                            const currentX = startX + (endX - startX) * (isNaN(prog) ? 0 : prog);

                            return (
                                <div
                                    key={i}
                                    className="absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
                                    style={{ left: `${currentX}%`, top: '15px', zIndex: 20 }}
                                >
                                    <div
                                        className="text-xs font-bold text-white px-2 py-1 rounded shadow-md whitespace-nowrap mb-1 flex items-center gap-1"
                                        style={{ backgroundColor: sch.color }}
                                    >
                                        <span>🚢←</span> {sch.label}
                                    </div>
                                    <div className="w-4 h-4 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: sch.color }}></div>
                                </div>
                            );
                        } catch (err) {
                            console.error("[ShipTracker] Render error for ship:", i, err);
                            return null;
                        }
                    })}
                </div>
            )}
        </div>
    );
};

export default ShipTracker;
