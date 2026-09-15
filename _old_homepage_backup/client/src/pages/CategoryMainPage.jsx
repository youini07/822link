import React from 'react';
import { Link } from 'react-router-dom';
import { getTranslation } from '../services/i18n';

const CategoryMainPage = ({ lang }) => {
    const STYLE_CATEGORIES = [
        { 
            id: 'casual', 
            name: '캐주얼 (Casual)', 
            paramKey: 'style', 
            paramVal: 'Casual,Classic Casual,Sporty Casual', 
            image: '/static/categories/casual_style.png'
        },
        { 
            id: 'sporty', 
            name: '스포티 & 아웃도어', 
            paramKey: 'style', 
            paramVal: 'Sports,Sportswear,Sporty,Outdoor,Functional,Gorpcore', 
            image: '/static/categories/sporty_style.png'
        },
        { 
            id: 'street', 
            name: '스트릿 & 빈티지', 
            paramKey: 'style', 
            paramVal: 'Streetwear,Retro,Vintage,OldSchool', 
            image: '/static/categories/street_style.png'
        },
        { 
            id: 'classic', 
            name: '클래식 & 미니멀', 
            paramKey: 'style', 
            paramVal: 'Classic,Contemporary,Preppy,Minimal,Chic', 
            image: '/static/categories/classic_style.png'
        }
    ];

    // 남/여 구분 없이 7개 카테고리 통합
    const UNIFIED_CATEGORIES = [
        { id: '상의', name: '상의', paramKey: 'upper_category', paramVal: '상의', image: '/static/categories/tops.png' },
        { id: '아우터', name: '아우터', paramKey: 'upper_category', paramVal: '아우터', image: '/static/categories/outerwear.png' },
        { id: '하의', name: '하의', paramKey: 'upper_category', paramVal: '하의', image: '/static/categories/bottoms.png' },
        { id: '원피스', name: '원피스', paramKey: 'upper_category', paramVal: '원피스', image: '/static/categories/dresses.png' },
        { id: '신발', name: '신발', paramKey: 'upper_category', paramVal: '신발', image: '/static/categories/shoes.png' },
        { id: '가방', name: '가방', paramKey: 'upper_category', paramVal: '가방', image: '/static/categories/bags.png' },
        { id: '액세서리', name: '액세서리', paramKey: 'upper_category', paramVal: '액세서리', image: '/static/categories/accessories.png' }
    ];

    return (
        <div className="w-full flex flex-col min-h-screen bg-white pt-2">
            {/* 전체 상품 보기 버튼 */}
            <div className="px-4 py-4">
                <Link 
                    to={`/?lang=${lang}&gender=&upper_category=&category=&brand=`}
                    className="w-full bg-gray-50 border border-gray-200 rounded-md py-3 flex justify-center items-center text-[13px] font-bold hover:bg-gray-100 transition-colors"
                >
                    {getTranslation(lang, 'view_all_products')}
                </Link>
            </div>

            {/* 스타일 카테고리 그리드 (새로 추가됨) */}
            <div className="px-4 pb-2">
                <h2 className="text-[16px] font-black tracking-wide text-gray-800">{getTranslation(lang, '스타일별 모아보기')}</h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 px-4 pb-6 mt-2">
                {STYLE_CATEGORIES.map(cat => (
                    <Link 
                        key={cat.id} 
                        to={`/?lang=${lang}&${cat.paramKey}=${encodeURIComponent(cat.paramVal)}`}
                        className="group relative flex flex-col cursor-pointer overflow-hidden rounded-md bg-gray-50 aspect-square"
                    >
                        {cat.image ? (
                            <img 
                                src={cat.image} 
                                alt={cat.name} 
                                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                            />
                        ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-gray-300">
                                No Image
                            </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent group-hover:opacity-80 transition-opacity duration-300"></div>
                        <div className="absolute bottom-2 left-2 z-10">
                            <h3 className="text-white font-extrabold text-[12px] md:text-sm tracking-tight drop-shadow-md">
                                {getTranslation(lang, cat.name)}
                            </h3>
                        </div>
                    </Link>
                ))}
            </div>

            <div className="w-full h-2 bg-gray-50 mb-6"></div>

            <div className="px-4 pb-2">
                <h2 className="text-[16px] font-black tracking-wide text-gray-800">{getTranslation(lang, '의류 카테고리')}</h2>
            </div>
            
            {/* 통합 카테고리 그리드: 모바일 3열, PC 4열 */}
            <div className="grid grid-cols-3 md:grid-cols-4 gap-2 md:gap-3 px-4 pb-8 mt-2">
                {UNIFIED_CATEGORIES.map(cat => (
                    <Link 
                        key={cat.id} 
                        // gender 파라미터 제외하여 남/여 모두 조회되도록 함
                        to={`/?lang=${lang}&${cat.paramKey || 'upper_category'}=${encodeURIComponent(cat.paramVal)}`}
                        className="group relative flex flex-col cursor-pointer overflow-hidden rounded-md bg-gray-50 aspect-square"
                    >
                        {cat.image ? (
                            <img 
                                src={cat.image} 
                                alt={cat.name} 
                                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                            />
                        ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-gray-300">
                                No Image
                            </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent group-hover:opacity-80 transition-opacity duration-300"></div>
                        <div className="absolute bottom-2 left-2 z-10">
                            <h3 className="text-white font-extrabold text-[12px] md:text-sm tracking-tight drop-shadow-md">
                                {getTranslation(lang, cat.name)}
                            </h3>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
};

export default CategoryMainPage;
