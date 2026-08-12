import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Le lint a sa propre commande (`npm run lint`) et ESLint n'est qu'une
  // dependance de developpement : le build ne doit pas en dependre.
  eslint: { ignoreDuringBuilds: true },

  webpack: (config) => {
    // L'alias est aussi declare dans tsconfig.json, mais Next ne lit ces `paths`
    // que si TypeScript est installe. Le declarer ici rend la resolution
    // independante de l'environnement d'installation.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.join(rootDir, 'src'),
    };
    return config;
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
