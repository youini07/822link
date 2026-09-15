import React, { useMemo } from 'react';

const SalesAnalyticsTab = ({ sales, t }) => {
    const { 
        totalRevenue, 
        totalVolume, 
        totalShippingExpense,
        asp, 
        topBrands, 
        topCategories, 
        priceDistribution 
    } = useMemo(() => {
        let _totalRevenue = 0;
        let _productSales = sales.filter(s => s['상품코드'] !== 'SHIPPING_FEE');
        let _totalVolume = _productSales.length;
        
        const brandsCount = {};
        const brandsRevenue = {};
        const categoriesCount = {};
        const categoriesRevenue = {};
        
        const tiers = {
            '~ 500฿': 0,
            '500 ~ 1000฿': 0,
            '1000 ~ 1500฿': 0,
            '1500฿ +': 0
        };

        // 주문별로 그룹화하여 무료배송 건수 집계
        const ordersMap = {};
        sales.forEach(sale => {
            const orderNum = sale['주문번호'];
            if (!ordersMap[orderNum]) {
                ordersMap[orderNum] = { hasShippingFee: false, hasProducts: false };
            }
            if (sale['상품코드'] === 'SHIPPING_FEE') {
                ordersMap[orderNum].hasShippingFee = true;
            } else {
                ordersMap[orderNum].hasProducts = true;
                
                // 매출 합산 (배송비 제외)
                const rawPriceStr = String(sale['판매가격'] || '0').replace(/[^0-9.]/g, '');
                const price = Number(rawPriceStr) || 0;
                _totalRevenue += price;
                
                const brand = sale['브랜드'] || '기타';
                brandsCount[brand] = (brandsCount[brand] || 0) + 1;
                brandsRevenue[brand] = (brandsRevenue[brand] || 0) + price;
                
                const cat = sale['category'] || '기타';
                categoriesCount[cat] = (categoriesCount[cat] || 0) + 1;
                categoriesRevenue[cat] = (categoriesRevenue[cat] || 0) + price;
                
                if (price < 500) tiers['~ 500฿']++;
                else if (price < 1000) tiers['500 ~ 1000฿']++;
                else if (price < 1500) tiers['1000 ~ 1500฿']++;
                else tiers['1500฿ +']++;
            }
        });

        // 무료배송 건수 = 배송비 항목이 없는데 상품은 있는 주문
        const freeShippingCount = Object.values(ordersMap).filter(o => o.hasProducts && !o.hasShippingFee).length;
        const _totalShippingExpense = freeShippingCount * 40;

        const _asp = _totalVolume > 0 ? Math.round(_totalRevenue / _totalVolume) : 0;
        
        const _topBrands = Object.keys(brandsRevenue)
            .map(b => ({ name: b, count: brandsCount[b], revenue: brandsRevenue[b] }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5);
            
        const _topCategories = Object.keys(categoriesRevenue)
            .map(c => ({ name: c, count: categoriesCount[c], revenue: categoriesRevenue[c] }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5);

        return {
            totalRevenue: _totalRevenue,
            totalVolume: _totalVolume,
            totalShippingExpense: _totalShippingExpense,
            asp: _asp,
            topBrands: _topBrands,
            topCategories: _topCategories,
            priceDistribution: tiers
        };
    }, [sales]);

    if (!sales || sales.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <span className="text-4xl mb-3">📊</span>
                <p>{t('analytics_no_data') || '판매 데이터가 없습니다'}</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center">
                    <p className="text-[10px] sm:text-xs text-gray-400 font-bold mb-1 uppercase bg-gray-50 px-2 py-0.5 rounded">{t('analytics_kpi_volume') || 'Total Volume'}</p>
                    <p className="text-xl sm:text-2xl font-black">{totalVolume}</p>
                </div>
                <div className="bg-gradient-to-br from-black to-gray-800 p-5 rounded-2xl shadow-sm text-white flex flex-col items-center justify-center text-center">
                    <p className="text-[10px] sm:text-xs text-gray-300 font-bold mb-1 uppercase bg-white/10 px-2 py-0.5 rounded">{t('analytics_kpi_sales') || 'Total Revenue'}</p>
                    <p className="text-xl sm:text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 to-yellow-100 filter drop-shadow">฿{totalRevenue.toLocaleString()}</p>
                </div>
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-red-50 flex flex-col items-center justify-center text-center">
                    <p className="text-[10px] sm:text-xs text-red-400 font-bold mb-1 uppercase bg-red-50 px-2 py-0.5 rounded">{t('analytics_kpi_shipping_cost') || 'Shipping Expense'}</p>
                    <p className="text-xl sm:text-2xl font-black text-red-500">฿{totalShippingExpense.toLocaleString()}</p>
                </div>
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center">
                    <p className="text-[10px] sm:text-xs text-gray-400 font-bold mb-1 uppercase bg-blue-50 text-blue-600 px-2 py-0.5 rounded whitespace-nowrap">{t('analytics_kpi_asp') || 'ASP'}</p>
                    <p className="text-xl sm:text-2xl font-black">฿{asp.toLocaleString()}</p>
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
                {/* Top Brands */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="bg-gray-50 px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                        <h3 className="font-bold text-sm text-gray-800">🏆 {t('analytics_top_brands') || 'Top Brands'}</h3>
                    </div>
                    <div className="p-5 space-y-4">
                        {topBrands.length > 0 ? topBrands.map((b, idx) => (
                            <div key={b.name} className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500">
                                        {idx + 1}
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold truncate max-w-[150px]">{b.name}</p>
                                        <p className="text-[10px] text-gray-400">{(t('analytics_sales_count') || '{count} items').replace('{count}', b.count)}</p>
                                    </div>
                                </div>
                                <span className="text-sm font-black whitespace-nowrap">฿{b.revenue.toLocaleString()}</span>
                            </div>
                        )) : <p className="text-xs text-gray-400 text-center py-4">데이터 없음</p>}
                    </div>
                </div>

                {/* Top Categories */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="bg-gray-50 px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                        <h3 className="font-bold text-sm text-gray-800">📂 {t('analytics_top_categories') || 'Top Categories'}</h3>
                    </div>
                    <div className="p-5 space-y-4">
                        {topCategories.length > 0 ? topCategories.map((c, idx) => (
                            <div key={c.name} className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-6 h-6 rounded-full bg-green-50 flex items-center justify-center text-xs font-bold text-green-600">
                                        {idx + 1}
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold truncate max-w-[150px]">{c.name}</p>
                                        <p className="text-[10px] text-gray-400">{(t('analytics_sales_count') || '{count} items').replace('{count}', c.count)}</p>
                                    </div>
                                </div>
                                <span className="text-sm font-black whitespace-nowrap">฿{c.revenue.toLocaleString()}</span>
                            </div>
                        )) : <p className="text-xs text-gray-400 text-center py-4">데이터 없음</p>}
                    </div>
                </div>
            </div>

            {/* Price Tiers */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="bg-gray-50 px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-bold text-sm text-gray-800">📊 {t('analytics_price_distribution') || 'Price Tier Distribution'}</h3>
                </div>
                <div className="p-5">
                    <div className="space-y-4">
                        {Object.entries(priceDistribution).map(([tier, count]) => {
                            const percentage = totalVolume > 0 ? (count / totalVolume) * 100 : 0;
                            return (
                                <div key={tier} className="text-sm">
                                    <div className="flex justify-between items-end mb-1.5">
                                        <span className="font-medium text-gray-700 text-xs">{tier}</span>
                                        <span className="font-bold text-sm">{count} <span className="text-gray-400 font-normal text-[10px] ml-1">({percentage.toFixed(1)}%)</span></span>
                                    </div>
                                    <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden ring-1 ring-inset ring-gray-200">
                                        <div className="bg-gradient-to-r from-blue-400 to-indigo-500 h-2.5 rounded-full filter drop-shadow-sm transition-all duration-500 ease-out" style={{ width: `${percentage}%` }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SalesAnalyticsTab;
