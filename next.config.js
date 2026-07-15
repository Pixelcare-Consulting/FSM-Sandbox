/** @type {import('next').NextConfig} */
const path = require("path");

// Extract Supabase hostname from environment variable
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
let supabaseHostname = null;
if (supabaseUrl) {
  try {
    const url = new URL(supabaseUrl);
    supabaseHostname = url.hostname;
  } catch (e) {
    // If URL parsing fails, use wildcard pattern
    supabaseHostname = '*.supabase.co';
  }
}

const nextConfig = {
  reactStrictMode: false,
  
  // Allow cross-origin requests from specific domains in development
  allowedDevOrigins: ['pxcserver.ddns.net'],
  
  // Image configuration for external domains.
  // Allow any *.supabase.co project — avatar/logo URLs may still point at an older
  // project ref than NEXT_PUBLIC_SUPABASE_URL (env-only allowlist would reject them).
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      ...(supabaseHostname
        ? [
            {
              protocol: 'https',
              hostname: supabaseHostname,
              pathname: '/storage/v1/object/public/**',
            },
          ]
        : []),
    ],
  },
  
  // Experimental features to improve connection stability
  experimental: {
    // Improve static file serving
    optimizeCss: false,
  },
  
  // Next.js 16: `next dev` uses Turbopack by default. A custom `webpack` function still applies to
  // `next build`; an explicit (possibly empty) `turbopack` key acknowledges that setup.
  // See https://nextjs.org/docs/app/api-reference/next-config-js/turbopack
  turbopack: {},
  
  // Compress responses to reduce transfer size and connection issues
  compress: true,
  
  env: {
    SAP_SERVICE_LAYER_BASE_URL: process.env.SAP_SERVICE_LAYER_BASE_URL,
    SAP_B1_COMPANY_DB: process.env.SAP_B1_COMPANY_DB,
    SAP_B1_USERNAME: process.env.SAP_B1_USERNAME,
    SAP_B1_PASSWORD: process.env.SAP_B1_PASSWORD,
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
    SYNCFUSION_LICENSE_KEY: process.env.SYNCFUSION_LICENSE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    /** AIFM Open API (pages/api/integrations/aifm/*). Read at build; set in .env / host env before build or dev start. */
    AIFM_API_TOKEN: process.env.AIFM_API_TOKEN,
    AIFM_BASE_URL: process.env.AIFM_BASE_URL,
  },

  // Production (`next build`) uses webpack; dev defaults to Turbopack (Next 16). See `turbopack` above.
  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer) {
      // Ensure WebSocket can connect from any hostname
      config.watchOptions = {
        poll: 800,
        aggregateTimeout: 300,
      };
    }

    // Memory optimization for large builds to prevent segmentation faults
    if (!dev) {
      config.optimization = {
        ...config.optimization,
        moduleIds: 'deterministic',
        splitChunks: {
          ...config.optimization.splitChunks,
          chunks: 'all',
          maxInitialRequests: 25,
          minSize: 20000,
          cacheGroups: {
            ...config.optimization.splitChunks?.cacheGroups,
            default: {
              minChunks: 2,
              priority: -20,
              reuseExistingChunk: true,
            },
            vendor: {
              test: /[\\/]node_modules[\\/]/,
              name: 'vendors',
              priority: -10,
              chunks: 'all',
            },
            apexcharts: {
              test: /[\\/]node_modules[\\/](apexcharts|react-apexcharts)[\\/]/,
              name: 'apexcharts',
              chunks: 'all',
              priority: 10,
            },
            syncfusion: {
              test: /[\\/]node_modules[\\/]@syncfusion[\\/]/,
              name: 'syncfusion',
              chunks: 'all',
              priority: 15,
            },
          },
        },
      };
    } else {
      // Fix for react-apexcharts chunk loading issues in dev
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          ...config.optimization.splitChunks,
          cacheGroups: {
            ...config.optimization.splitChunks?.cacheGroups,
            apexcharts: {
              test: /[\\/]node_modules[\\/](apexcharts|react-apexcharts)[\\/]/,
              name: 'apexcharts',
              chunks: 'all',
              priority: 10,
            },
          },
        },
      };
    }

    return config;
  },

  sassOptions: {
    includePaths: [
      path.join(__dirname, "styles"),
      path.join(__dirname, "node_modules"),
      path.join(__dirname, "node_modules/bootstrap/scss")
    ],
    silenceDeprecations: ['legacy-js-api', 'import', 'global-builtin', 'color-functions'],
    quietDeps: true,
  },

  async headers() {
    const headerRules = [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET,DELETE,PATCH,POST,PUT",
          },
          {
            key: "Access-Control-Allow-Headers",
            value:
              "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version",
          },
        ],
      },
      {
        source: '/site.webmanifest',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/manifest+json',
          },
        ],
      },
    ];

    // Long cache on hashed static assets is fine in production only; in dev it breaks HMR/Turbopack.
    if (process.env.NODE_ENV === 'production') {
      headerRules.push({
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'Connection',
            value: 'keep-alive',
          },
        ],
      });
    }

    headerRules.push({
      source: '/_next/webpack-hmr',
      headers: [
        {
          key: 'Connection',
          value: 'Upgrade',
        },
        {
          key: 'Upgrade',
          value: 'websocket',
        },
      ],
    });

    return headerRules;
  },

  async rewrites() {
    return [
      // DASHBOARD/OVERVIEW
      {
        source: "/dashboard",
        destination: "/dashboard/overview",
      },
      // CUSTOMERS
      {
        source: "/customers",
        destination: "/dashboard/customers/list",
      },
      {
        source: "/customers/view/:id",
        destination: "/dashboard/customers/:id",
      },
      {
        source: "/customers/create",
        destination: "/dashboard/customers/create",
      },
      {
        source: "/customers/sap-api",
        destination: "/dashboard/customers/list-sap-api",
      },
      {
        source: "/customers/sap-view/:id",
        destination: "/dashboard/customers/sap-view/:id",
      },

      // LEADS
      {
        source: "/leads",
        destination: "/dashboard/leads/list",
      },
      {
        source: "/leads/sap-api",
        destination: "/dashboard/leads/list-sap-api",
      },
      {
        source: "/leads/view/:leadCode",
        destination: "/dashboard/leads/view/:leadCode",
      },

      // WORKERS
      {
        source: "/workers/create",
        destination: "/dashboard/workers/create-worker",
      },
      {
        source: "/workers",
        destination: "/dashboard/workers/list",
      },
      {
        source: "/workers/view/:id",
        destination: "/dashboard/workers/view/:id",
      },
      {
        source: "/workers/edit-worker/:workerId",
        destination: "/dashboard/workers/:workerId",
      },
      {
        source: "/workers/attendance",
        destination: "/dashboard/workers/attendance",
      },

      // SCHEDULING
      {
        source: "/jobs/calendar",
        destination: "/dashboard/scheduling/jobs/calendar",
      },
      {
        source: "/schedule",
        destination: "/dashboard/scheduling/workers/schedules",
      },
      {
        source: "/scheduler",
        destination: "/dashboard/scheduling/workers/scheduler",
      },
      {
        source: "/company-calendar",
        destination: "/dashboard/scheduling/company-calendar",
      },

      // JOBS
      {
        source: "/jobs",
        destination: "/dashboard/jobs/list-jobs",
      },
      {
        source: "/jobs/live-tracking",
        destination: "/dashboard/jobs/live-tracking",
      },
      {
        source: "/jobs/view/:jobId",
        destination: "/dashboard/jobs/:jobId", // Rewrite to /dashboard/jobs/{jobId}
      },
      {
        source: "/jobs/edit-jobs/:id",
        destination: "/dashboard/jobs/edit-jobs/:id",
      },
      {
        source: "/jobs/create",
        destination: "/dashboard/jobs/create-jobs",
      },
      {
        source: "/jobs/create-jobs",
        destination: "/dashboard/jobs/create-jobs?",
      },
      {
        source: "/jobs/:jobId",
        destination: "/dashboard/jobs/:jobId",
      },
      // Follow-Ups
      {
        source: "/follow-ups",
        destination: "/dashboard/follow-ups",
      },

      // Customer Leads
      {
        source: "/customer-leads",
        destination: "/customer-leads",
      },

      // AUTHENTICATION
      {
        source: "/sign-in",
        destination: "/authentication/sign-in",
      },
    ];
  },

  async redirects() {
    return [
      {
        source: "/",
        destination: "/dashboard",
        permanent: true,
      },
      // Some environments (or proxies) don't apply rewrites consistently in dev.
      // Keep a redirect so `/customers/view/:id` never 404s even if rewrites are skipped.
      {
        source: "/customers/view/:id",
        destination: "/dashboard/customers/:id",
        permanent: false,
      },
      {
        source: "/customers/view/:id/",
        destination: "/dashboard/customers/:id",
        permanent: false,
      },
      {
        source: "/jobs/view/:jobId",
        destination: "/dashboard/jobs/:jobId",
        permanent: false,
      },
      {
        source: "/jobs/view/:jobId/",
        destination: "/dashboard/jobs/:jobId",
        permanent: false,
      },
      {
        source: "/dashboard/reports/payroll/hours-by-employee",
        destination: "/dashboard/reports/hours-by-employee",
        permanent: true,
      },
      // AIFM preview: common wrong path/order + "airm" typo → canonical route
      {
        source: "/dashboard/jobs/integrations/airm-jobs",
        destination: "/dashboard/integrations/aifm-jobs",
        permanent: true,
      },
      {
        source: "/dashboard/jobs/integrations/aifm-jobs",
        destination: "/dashboard/integrations/aifm-jobs",
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
