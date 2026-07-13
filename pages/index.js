import { Fragment, useEffect } from 'react';
import { useRouter } from 'next/router';
import 'react-toastify/dist/ReactToastify.css';

const DASHBOARD_HOME = '/dashboard/overview';

const Home = () => {
  const router = useRouter();

  useEffect(() => {
    router.replace(DASHBOARD_HOME);
  }, [router]);

  return <Fragment />;
};

export default Home;
