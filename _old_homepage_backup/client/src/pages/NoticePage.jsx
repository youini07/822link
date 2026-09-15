import { useState, useEffect } from 'react';
import { fetchNotices } from '../services/api';
import { getTranslation } from '../services/i18n';

const NoticePage = ({ lang }) => {
    const [notices, setNotices] = useState([]);
    const [loading, setLoading] = useState(true);

    const tTitle = getTranslation(lang, 'nav_notice');

    useEffect(() => {
        const loadNotices = async () => {
            setLoading(true);
            try {
                const data = await fetchNotices();
                setNotices(data);
            } catch (err) {
                console.error(err);
            }
            setLoading(false);
        };
        loadNotices();
        window.scrollTo(0, 0);
    }, []);

    const filterContentByLang = (content, targetLang) => {
        if (!content) return "";

        // Pattern 1: [KR] ... [EN] ... [TH] ...
        // Pattern 2: KR: ... EN: ... TH: ...
        // Pattern 3: (KR) ... (EN) ... (TH) ...
        const langMarkers = {
            'KR': [/\[KR\]/i, /KR:/i, /\(KR\)/i, /한국어:/i, /TH 태국어 버전 \(TH\)/i], // Added specific marker seen in screenshot
            'EN': [/\[EN\]/i, /EN:/i, /\(EN\)/i, /ENGLISH:/i],
            'TH': [/\[TH\]/i, /TH:/i, /\(TH\)/i, /태국어:/i, /TH 태국어 버전 \(TH\)/i]
        };

        const allMarkers = [/\[[A-Z]{2}\]/i, /[A-Z]{2}:/i, /\([A-Z]{2}\)/i, /한국어:/i, /ENGLISH:/i, /태국어:/i, /TH 태국어 버전 \(TH\)/i];

        // Find segments
        const lines = content.split('\n');
        let currentSection = "";
        let foundAnyMarker = false;
        let isCollecting = false;

        // Simple check: if content doesn't seem to have markers, return all
        if (!allMarkers.some(m => m.test(content))) return content;

        for (let line of lines) {
            const trimmed = line.trim();

            // Check if this line is a marker for our target language
            if (langMarkers[targetLang].some(m => m.test(trimmed))) {
                isCollecting = true;
                foundAnyMarker = true;
                continue;
            }

            // Check if this line is a marker for ANY OTHER language
            const otherLangs = Object.keys(langMarkers).filter(l => l !== targetLang);
            if (otherLangs.some(l => langMarkers[l].some(m => m.test(trimmed)))) {
                isCollecting = false;
                continue;
            }

            if (isCollecting) {
                currentSection += line + '\n';
            }
        }

        return foundAnyMarker ? currentSection.trim() : content;
    };

    return (
        <div className="max-w-7xl mx-auto px-4 md:px-8 mt-4">
            <div className="py-10 text-center mb-6">
                <h1 className="text-black tracking-[5px] font-black text-2xl uppercase m-0">{tTitle}</h1>
                <p className="text-gray-400 text-sm mt-3">{getTranslation(lang, 'updates_announcements')}</p>
            </div>

            <div className="max-w-4xl mx-auto">
                {loading ? (
                    <div className="text-center py-10">{getTranslation(lang, 'loading')}</div>
                ) : notices.length === 0 ? (
                    <div className="text-center py-10 text-gray-500 bg-gray-50 rounded-lg">{getTranslation(lang, 'no_notices')}</div>
                ) : (
                    <div className="space-y-6">
                        {notices.map(n => (
                            <div key={n.id} className="border border-border rounded-lg p-6 bg-white shadow-sm hover:border-gray-300 transition-colors">
                                <h3 className="text-xl font-bold mb-2">📌 {n.title}</h3>
                                <div className="text-xs text-gray-500 mb-4 font-mono">📅 {new Date(n.created_at).toLocaleDateString()} | 👤 {n.author}</div>
                                <div
                                    className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap"
                                    dangerouslySetInnerHTML={{ __html: filterContentByLang(n.content, lang) }}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default NoticePage;
