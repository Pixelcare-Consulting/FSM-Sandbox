import React from 'react';
import FooterWithSocialIcons from "@/layouts/marketing/footers/FooterWithSocialIcons";

const MainLayout = ({ children, showFooter = true }) => {
  return (
    <div className="d-flex flex-column min-vh-100">
      <main className="flex-grow-1">
        {children}
      </main>
      {showFooter && <FooterWithSocialIcons />}
    </div>
  );
};

export default MainLayout;
