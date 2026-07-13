import Head from "next/head";
import dynamic from "next/dynamic";
import { useEffect, useState, Fragment } from "react";
import { useRouter } from "next/router";
import { NextSeo } from "next-seo";
import { QueryClientProvider } from 'react-query';
import { getQueryClient } from '../lib/queryClient';
import { Provider } from "react-redux";
import { StyleSheetManager } from "styled-components";
import isPropValid from "@emotion/is-prop-valid";
import { store } from "store/store";
import ActivityTracker from '../components/ActivityTracker';
import { useSessionCheck } from '../hooks/useSessionCheck';
import LoadingOverlay from '../components/LoadingOverlay';
import AppWarmupOverlay from '../components/AppWarmupOverlay';
import { AppWarmupProvider } from '../contexts/AppWarmupContext';
import { SettingsProvider } from '../contexts/SettingsContext';
import { LogoProvider } from '../contexts/LogoContext';
import { AuthProvider } from '../contexts/AuthContext';

// Layouts
import DefaultMarketingLayout from "layouts/marketing/DefaultLayout";
import DefaultDashboardLayout from "layouts/dashboard/DashboardIndexTop";
import MainLayout from "@/layouts/MainLayout";

// Styles
import "../styles/theme.scss";

const PortalAssistantChat = dynamic(
  () => import("layouts/dashboard/_components/PortalAssistantChat"),
  { ssr: false }
);

const shouldForwardProp = (prop, target) =>
  typeof target === "string" ? isPropValid(prop) : true;

function DashboardSessionCheck() {
  useSessionCheck();
  return null;
}

const queryClient = getQueryClient();

function MyApp({ Component, pageProps }) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  
  const pageURL = process.env.baseURL + router.pathname;
  const title = "SAS M&E - Field Services Management System | Portal";
  const description = "Discover SAS M&E, your ultimate Field Services Management System portal. Utilize the portal with ease!";
  const keywords = "SAS M&E, Field Services Management System, Portal, web apps, Pixelcare Consulting";

  const useDashboardChrome =
    router.pathname.includes("dashboard") ||
    router.pathname.startsWith("/customers/view");

  const Layout = Component.Layout ||
    (useDashboardChrome ? DefaultDashboardLayout : DefaultMarketingLayout);

  const isSignInPage = router.pathname === '/sign-in' || router.pathname === '/authentication/sign-in';

  useEffect(() => {
    const handleStart = () => setIsLoading(true);
    const handleComplete = () => setIsLoading(false);

    router.events.on('routeChangeStart', handleStart);
    router.events.on('routeChangeComplete', handleComplete);
    router.events.on('routeChangeError', handleComplete);

    return () => {
      router.events.off('routeChangeStart', handleStart);
      router.events.off('routeChangeComplete', handleComplete);
      router.events.off('routeChangeError', handleComplete);
    };
  }, [router.events]);

  return (
    <StyleSheetManager shouldForwardProp={shouldForwardProp}>
    <AuthProvider>
      <LogoProvider>
        <SettingsProvider>
          <Fragment>
            <Head>
              <meta name="viewport" content="width=device-width, initial-scale=1" />
              <meta name="keywords" content={keywords} />
              <link rel="icon" type="image/x-icon" href="/favicon.ico" />
              <meta name="msapplication-TileColor" content="#da532c" />
              <meta name="theme-color" content="#ffffff" />
            </Head>
            <style jsx global>{`
              :root {
                --font-poppins: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
              }
              html, body {
                font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif !important;
              }
              body, p, div, span, h1, h2, h3, h4, h5, h6, a, button, input, textarea, select, label {
                font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif !important;
              }
            `}</style>
            <NextSeo
              title={title}
              description={description}
              canonical={pageURL}
              openGraph={{
                url: pageURL,
                title: title,
                description: description,
                site_name: process.env.siteName,
              }}
            />
            <Provider store={store}>
              <QueryClientProvider client={queryClient}>
                <AppWarmupProvider>
                  <MainLayout showFooter={!isSignInPage}>
                    <Layout>
                      <Component {...pageProps} setIsLoading={setIsLoading} />
                      {useDashboardChrome && !isSignInPage && (
                        <>
                          <ActivityTracker />
                          <DashboardSessionCheck />
                        </>
                      )}
                      <LoadingOverlay isLoading={isLoading} />
                    </Layout>
                  </MainLayout>
                  {useDashboardChrome && <PortalAssistantChat />}
                  <AppWarmupOverlay />
                </AppWarmupProvider>
              </QueryClientProvider>
            </Provider>
          </Fragment>
        </SettingsProvider>
      </LogoProvider>
    </AuthProvider>
    </StyleSheetManager>
  );
}

export default MyApp;
