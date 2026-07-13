import { Card } from 'react-bootstrap';

export const STICKY_SEARCH_GRADIENT_BLUE = {
  background: 'linear-gradient(90deg, #4171F5 0%, #3DAAF5 100%)',
};

export const STICKY_SEARCH_GRADIENT_PURPLE = {
  background: 'linear-gradient(90deg, #7C3AED 0%, #A78BFA 100%)',
};

/**
 * Sticky shell for list-page global search / filter bars.
 * Sticky behavior is defined in styles/theme/components/_navbar.scss (.dashboard-list-sticky-search).
 */
const DashboardListStickySearch = ({
  children,
  className = '',
  bodyClassName = 'p-3',
  style,
  ...rest
}) => (
  <Card
    className={`dashboard-list-sticky-search border-0 shadow-sm mb-3 ${className}`.trim()}
    style={style}
    {...rest}
  >
    <Card.Body className={bodyClassName}>{children}</Card.Body>
  </Card>
);

export default DashboardListStickySearch;
