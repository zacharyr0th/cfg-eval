import type { Config } from "tailwindcss";

const config: Config = {
    darkMode: ["class"],
    content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
  	extend: {
  		fontFamily: {
  			sans: ['var(--font-geist-sans)', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
  			mono: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular', 'SF Mono', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'],
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 4px)',
  			sm: 'calc(var(--radius) - 8px)',
  			xl: 'calc(var(--radius) + 4px)',
  			'2xl': 'calc(var(--radius) + 8px)',
  		},
  		boxShadow: {
  			'apple-sm': '0 1px 2px rgba(0,0,0,0.04)',
  			'apple': '0 4px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)',
  			'apple-lg': '0 12px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06)',
  			'apple-xl': '0 24px 80px rgba(0,0,0,0.16), 0 8px 24px rgba(0,0,0,0.08)',
  		},
  		transitionTimingFunction: {
  			'apple': 'cubic-bezier(0.25, 0.1, 0.25, 1)',
  			'apple-bounce': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  		},
  		transitionDuration: {
  			'250': '250ms',
  			'350': '350ms',
  		},
  		spacing: {
  			'18': '4.5rem',
  			'22': '5.5rem',
  		},
  		colors: {
  			// Muted/pastel semantic colors. All AA-safe when used as
  			// text-X-{600,700,800,900} on white or bg-X-50.
  			success: {  // soft sage
  				50: 'hsl(150 22% 96%)',
  				100: 'hsl(150 22% 90%)',
  				200: 'hsl(150 18% 82%)',
  				300: 'hsl(150 18% 72%)',
  				600: 'hsl(150 28% 34%)',
  				700: 'hsl(150 22% 28%)',
  				800: 'hsl(150 18% 24%)',
  				900: 'hsl(150 18% 16%)',
  				950: 'hsl(150 18% 10%)',
  			},
  			warning: {  // soft sand
  				50: 'hsl(35 35% 96%)',
  				100: 'hsl(35 35% 89%)',
  				200: 'hsl(35 32% 80%)',
  				300: 'hsl(35 30% 70%)',
  				600: 'hsl(30 48% 34%)',
  				700: 'hsl(30 38% 28%)',
  				800: 'hsl(30 28% 24%)',
  				900: 'hsl(30 22% 18%)',
  				950: 'hsl(30 20% 12%)',
  			},
  			danger: {  // soft dusty rose
  				50: 'hsl(5 35% 96%)',
  				100: 'hsl(5 35% 92%)',
  				200: 'hsl(5 30% 84%)',
  				300: 'hsl(5 30% 72%)',
  				600: 'hsl(5 35% 46%)',
  				700: 'hsl(5 30% 36%)',
  				800: 'hsl(5 25% 26%)',
  				900: 'hsl(5 22% 18%)',
  				950: 'hsl(5 20% 12%)',
  			},
  			info: {  // soft periwinkle
  				50: 'hsl(215 30% 96%)',
  				100: 'hsl(215 30% 91%)',
  				200: 'hsl(215 25% 82%)',
  				300: 'hsl(215 25% 72%)',
  				600: 'hsl(215 38% 42%)',
  				700: 'hsl(215 32% 34%)',
  				800: 'hsl(215 25% 26%)',
  				900: 'hsl(215 22% 18%)',
  				950: 'hsl(215 20% 12%)',
  			},
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			}
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
