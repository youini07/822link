export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                background: '#ffffff',
                text: '#1a1a1a',
                accent: '#000000',
                border: '#eeeeee',
                softBg: '#f9f9f9',
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
            },
        },
    },
    plugins: [],
}
