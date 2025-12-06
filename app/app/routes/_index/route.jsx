import { redirect } from "@remix-run/node";
import { Form } from "@remix-run/react";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const search = url.searchParams.toString();
  const target = search ? `/app?${search}` : "/app";
  throw redirect(target);
};

// Unused because loader always redirects, but Remix requires a component.
export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Redirecting…</h1>
        <Form className={styles.form} method="post" action="/auth/login">
          <label className={styles.label}>
            <span>Shop domain</span>
            <input className={styles.input} type="text" name="shop" />
            <span>e.g: my-shop-domain.myshopify.com</span>
          </label>
          <button className={styles.button} type="submit">
            Log in
          </button>
        </Form>
      </div>
    </div>
  );
}
