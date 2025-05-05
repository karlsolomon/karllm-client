/** @type {import('tailwindcss').Config} */
import daisyui from "daisyui";
console.log("Tailwind config loaded.");

export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}"],
    darkMode: "class",
    theme: {
        extend: {},
    },
    plugins: [daisyui],
    daisyui: {
        themes: ["dark"],
        darkTheme: "dark",
    },
};
