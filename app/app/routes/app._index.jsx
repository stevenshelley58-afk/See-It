import { useLoaderData, useRouteError, isRouteErrorResponse, Link } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { PLANS } from "../billing";
import styles from "./app._index.module.css";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  let shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });

  if (!shop) {
    const shopResponse = await admin.graphql(
      `#graphql
        query {
          shop {
            id
          }
        }
      `
    );
    const shopData = await shopResponse.json();
    const shopifyShopId = shopData.data.shop.id.replace('gid://shopify/Shop/', '');

    shop = await prisma.shop.create({
      data: {
        shopDomain: session.shop,
        shopifyShopId: shopifyShopId,
        accessToken: session.accessToken || "pending",
        plan: PLANS.FREE.id,
        dailyQuota: PLANS.FREE.dailyQuota,
        monthlyQuota: PLANS.FREE.monthlyQuota
      }
    });
  }

  // Get total completed renders (customer uses)
  const totalRenders = await prisma.renderJob.count({
    where: { shopId: shop.id, status: "completed" }
  });

  // Get products ready
  const productsReady = await prisma.productAsset.count({
    where: { shopId: shop.id, status: "ready" }
  });

  // Calculate success rate (completed vs failed)
  const statusCounts = await prisma.renderJob.groupBy({
    by: ['status'],
    where: {
      shopId: shop.id,
      status: { in: ['completed', 'failed'] }
    },
    _count: true
  });
  const completed = statusCounts.find(s => s.status === 'completed')?._count || 0;
  const failed = statusCounts.find(s => s.status === 'failed')?._count || 0;
  const successRate = completed + failed > 0 ? Math.round((completed / (completed + failed)) * 100) : 0;

  return json({
    customerViews: totalRenders,
    successRate,
    enabledProductsCount: productsReady
  });
};

export default function Index() {
  const { customerViews, successRate, enabledProductsCount } = useLoaderData();

  return (
    <>
      <TitleBar title="See It" />
      <div style={{ background: '#f6f6f7', minHeight: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif' }}>
        <div className={styles.container}>
          <header>
            <h1 className={styles.h1}>See It</h1>
            <p className={styles.subtitle}>Product visualization for your store</p>
          </header>

          <div className={styles.stats}>
            <div className={styles.stat}>
              <div className={styles.statValue}>{customerViews}</div>
              <div className={styles.statLabel}>Customer views</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue}>{successRate}%</div>
              <div className={styles.statLabel}>Success rate</div>
            </div>
          </div>

          <nav className={styles.navCards}>
            <Link to="/app/products" className={styles.navCard}>
              <div className={styles.navCardLeft}>
                <div className={styles.navCardIcon}>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <div>
                  <div className={styles.navCardTitle}>Products</div>
                  <div className={styles.navCardDesc}>Manage enabled products</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span className={styles.badge}>{enabledProductsCount}</span>
                <div className={styles.navCardArrow}>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Link>

            <Link to="/app/analytics" className={styles.navCard}>
              <div className={styles.navCardLeft}>
                <div className={styles.navCardIcon}>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                  </svg>
                </div>
                <div>
                  <div className={styles.navCardTitle}>Analytics</div>
                  <div className={styles.navCardDesc}>View performance insights</div>
                </div>
              </div>
              <div className={styles.navCardArrow}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>

            <Link to="/app/settings" className={styles.navCard}>
              <div className={styles.navCardLeft}>
                <div className={styles.navCardIcon}>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <div>
                  <div className={styles.navCardTitle}>Settings</div>
                  <div className={styles.navCardDesc}>Configure your preferences</div>
                </div>
              </div>
              <div className={styles.navCardArrow}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          </nav>
        </div>
      </div>
    </>
  );
}

// Error boundary
export function ErrorBoundary() {
  const error = useRouteError();

  let title = "Something went wrong";
  let message = "An unexpected error occurred. Please try refreshing the page.";

  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`;
    message = error.data?.message || "The requested resource could not be loaded.";
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <>
      <TitleBar title="See It" />
      <div style={{ background: '#f6f6f7', minHeight: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif', padding: '32px 24px' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ marginBottom: '16px' }}>
              <h1 style={{ fontSize: '18px', fontWeight: '600', color: '#dc2626', marginBottom: '8px' }}>{title}</h1>
              <p style={{ fontSize: '14px', color: '#6b7280' }}>{message}</p>
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button
                onClick={() => window.location.reload()}
                style={{
                  background: '#1a1a1a',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 20px',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer'
                }}
              >
                Refresh Page
              </button>
              <button
                onClick={() => window.location.href = '/app'}
                style={{
                  background: '#fff',
                  color: '#1a1a1a',
                  border: '1px solid #e5e5e5',
                  borderRadius: '8px',
                  padding: '10px 20px',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer'
                }}
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
