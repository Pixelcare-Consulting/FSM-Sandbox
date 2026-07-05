/**
 * This layout will be applicable if you want Navigation bar on top side or horizontal style navigation in Dashboard.
 */

// import node module libraries
import { useState } from 'react';
import Link from 'next/link';
import {
	Container,
	Nav,
	Navbar,
	Form,
	Image
} from 'react-bootstrap';
// Firebase removed - using Supabase instead

// import sub components
import NavDropdownMain from './navbars/NavDropdownMain';
import DocumentMenu from './navbars/DocumentMenu';

// import sub components
import QuickMenu from 'layouts/QuickMenu';
import CompanyMemoTicker from './_components/CompanyMemoTicker';
import CompanyMemosSignInModal from './_components/CompanyMemosSignInModal';

// import routes file
import NavbarTopRoutes from 'routes/dashboard/NavbarTopRoutes';

// import utility function
import { getCompanyDetails } from '../../utils/companyCache';
import { useLogo } from '../../contexts/LogoContext';
import { useSessionCheck } from '../../hooks/useSessionCheck';
import Cookies from 'js-cookie';

/** Horizontal padding for top-nav + page body — keep in sync with dashboard hero inner wrapper (overview). */
const PAGE_GUTTER = 'px-3 px-sm-4';

const DashboardIndexTop = (props) => {
	const { logo } = useLogo();
	const isAdminNav = Cookies.get('isAdmin') === 'true';
	const [expandedMenu, setExpandedMenu] = useState(false);
	useSessionCheck();

	return (
		<div>
			<CompanyMemosSignInModal />
			<Navbar
				bg="white"
				expand="lg"
				className="py-1 py-md-2 px-0"
				onToggle={(collapsed) => setExpandedMenu(collapsed)}
			>
				<Container fluid className={`${PAGE_GUTTER} d-flex flex-wrap align-items-center`}>
					<div className="d-flex align-items-center flex-grow-1 min-w-0 me-2">
						{/* brand logo */}
						<Navbar.Brand
							as={Link}
							href="/"
							className="py-0 my-0 flex-shrink-0"
						>
							<Image 
								src={logo} 
								alt="Company Logo"
								style={{ height: '76px', minWidth: '120px', maxWidth: '220px', width: 'auto', objectFit: 'contain' }} 
							/>
						</Navbar.Brand>
						<span
							className="ms-2 ms-md-3 flex-shrink-0 fw-bold text-uppercase"
							style={{
								fontSize: '0.9rem',
								letterSpacing: '0.14em',
								color: '#d97706',
								border: '2px solid #d97706',
								borderRadius: '4px',
								padding: '4px 10px',
								lineHeight: 1.2,
							}}
							aria-label="Sandbox environment"
						>
							SANDBOX
						</span>
						<CompanyMemoTicker />
					</div>
					{/* search box */}
					<div className="ms-lg-3 d-none d-md-none d-lg-block">
					
					</div>
					{/* Right side quick / shortcut menu  */}

					<Nav className="navbar-nav navbar-right-wrap ms-auto d-flex nav-top-wrap">
						<span className={`d-flex`}>
							<QuickMenu />
						</span>
					</Nav>

					<Navbar.Toggle aria-controls="navbarScroll">
						<span className="icon-bar top-bar mt-0"></span>
						<span className="icon-bar middle-bar"></span>
						<span className="icon-bar bottom-bar"></span>
					</Navbar.Toggle>
				</Container>
			</Navbar>
			<Navbar
				expand="lg"
				className="navbar-default py-0 py-lg-1 px-0 mb-4"
				expanded={expandedMenu}
			>
				<Container fluid className={PAGE_GUTTER}>
					<Navbar.Collapse id="navbarScroll">
						<Nav className="navbar-nav dashboard-top-menu-nav flex-row flex-nowrap align-items-center w-100">
							<div className="d-flex flex-row flex-nowrap align-items-center">
								{NavbarTopRoutes.filter(
									(item) =>
										!item.alignEnd && (!item.adminOnly || isAdminNav)
								).map((item, index) => (
									<NavDropdownMain
										item={item}
										key={item.id || index}
										onClick={(value) => setExpandedMenu(value)}
									/>
								))}
							</div>
							<div className="d-flex flex-row flex-nowrap align-items-center ms-auto">
								{NavbarTopRoutes.filter(
									(item) =>
										item.alignEnd && (!item.adminOnly || isAdminNav)
								).map((item, index) => (
									<NavDropdownMain
										item={item}
										key={item.id || `end-${index}`}
										onClick={(value) => setExpandedMenu(value)}
									/>
								))}
							</div>
						</Nav>
					</Navbar.Collapse>
				</Container>
			</Navbar>
			<Container fluid className={`mt-2 mb-6 ${PAGE_GUTTER}`}>
				{props.children}
			</Container>
		</div>
	);
};
export default DashboardIndexTop;
