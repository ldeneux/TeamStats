/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf.js (import de l'effectif depuis un PDF) charge « canvas » seulement côté Node : on l'ignore dans le bundle navigateur.
  webpack: (config) => {
    config.resolve.alias = { ...(config.resolve.alias || {}), canvas: false };
    return config;
  },
};

module.exports = nextConfig;
