import type { NextConfig } from "next";
import path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const nextConfig: NextConfig = {
  // Use standalone mode for Vercel deployment
  output: 'standalone',
  outputFileTracingRoot: path.resolve(__dirname),

  // Disable static optimization for pages that use client-side only features
  experimental: {
    optimizePackageImports: ['@privy-io/react-auth'],
  },

  // Turbopack configuration (Next.js 16+ default)
  turbopack: {
    resolveAlias: {
      // Replace viem test actions with empty modules
      'viem/actions/test': './lib/empty-module.js',
      // Ignore these modules
      'tap': './lib/empty-module.js',
      'why-is-node-running': './lib/empty-module.js',
    },
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
  },

  webpack: (config, { isServer, webpack }) => {

    // Replace viem test actions with empty modules
    config.plugins = config.plugins || [];
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /\/actions\/test\//,
        (resource: any) => {
          // Use absolute path resolution that works in all environments
          resource.request = path.resolve(__dirname, 'lib/empty-module.js');
        }
      ),
      new webpack.IgnorePlugin({
        resourceRegExp: /^(tap|why-is-node-running)$/,
      })
    );

    // Fallback for node modules
    config.resolve = config.resolve || {};
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      tap: false,
      'why-is-node-running': false,
    };

    return config;
  },
};

export default nextConfig;
