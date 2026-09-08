/** @type {import('next').NextConfig} */
const nextConfig = {
  // mammoth and xlsx need Node APIs, so extraction routes declare
  // `export const runtime = 'nodejs'` individually. See DESIGN.md section 6.
  serverExternalPackages: ["mammoth", "xlsx"],

  // There is an unrelated package-lock.json further up the user's Documents
  // tree; without this Next infers that as the workspace root and traces the
  // wrong files.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
