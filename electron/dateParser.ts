// @ts-nocheck
export function parseKoreanDateStr(input) {
    const now = new Date();
    const text = input.trim().toLowerCase();
    let targetDate = new Date(now.getTime());
    // 날짜 키워드 처리
    if (text.includes('오늘')) {
        // targetDate is already today
    }
    else if (text.includes('내일')) {
        targetDate.setDate(targetDate.getDate() + 1);
    }
    else if (text.includes('모레')) {
        targetDate.setDate(targetDate.getDate() + 2);
    }
    else {
        // MM-DD 또는 MM/DD 형식 찾기
        const dateMatch = text.match(/(\d{1,2})[-/월\s]+(\d{1,2})[일\s]*/);
        if (dateMatch) {
            const month = parseInt(dateMatch[1], 10) - 1;
            const date = parseInt(dateMatch[2], 10);
            targetDate.setMonth(month, date);
            // 만약 과거 날짜라면 내년으로 간주
            if (targetDate.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
                targetDate.setFullYear(targetDate.getFullYear() + 1);
            }
        }
    }
    // 시간 처리 HH:mm
    const timeMatch = text.match(/(\d{1,2})[:시\s]+(\d{1,2})?[분\s]*/);
    if (timeMatch) {
        let hours = parseInt(timeMatch[1], 10);
        const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
        // 오전/오후 처리
        if (text.includes('오후') && hours < 12) {
            hours += 12;
        }
        else if (text.includes('오전') && hours === 12) {
            hours = 0;
        }
        targetDate.setHours(hours, minutes, 0, 0);
        // 만약 "오늘" 등의 명시적 날짜가 없고 시간만 있는데, 이미 지난 시간이라면 내일로 설정
        if (!text.includes('오늘') && !text.includes('내일') && !text.includes('모레') && !text.match(/(\d{1,2})[-/월\s]+(\d{1,2})/)) {
            if (targetDate.getTime() <= now.getTime()) {
                targetDate.setDate(targetDate.getDate() + 1);
            }
        }
        return targetDate.getTime();
    }
    return null;
}
