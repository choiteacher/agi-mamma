import React, { useContext } from 'react';
import { Link } from 'react-router-dom';

// project import
import NavRight from './NavRight';
import LockButton from '../../../gate/LockButton';

import { ConfigContext } from '../../../contexts/ConfigContext';
import * as actionType from '../../../store/actions';
import { SERVICE_NAME } from '../../../config/constant';

// ==============================|| NAV BAR ||============================== //

const NavBar = () => {
  const configContext = useContext(ConfigContext);
  const { collapseMenu, layout } = configContext.state;
  const { dispatch } = configContext;

  let headerClass = ['navbar', 'pcoded-header', 'navbar-expand-lg', 'header-blue', 'headerpos-fixed'];
  if (layout === 'vertical') {
    headerClass = [...headerClass, 'headerpos-fixed'];
  }

  let toggleClass = ['mobile-menu'];
  if (collapseMenu) {
    toggleClass = [...toggleClass, 'on'];
  }

  const navToggleHandler = () => {
    dispatch({ type: actionType.COLLAPSE_MENU });
  };

  const collapseClass = ['collapse navbar-collapse'];

  let navBar = (
    <React.Fragment>
      <div className="m-header">
        <Link to="#" className={toggleClass.join(' ')} id="mobile-collapse" onClick={navToggleHandler}>
          <span />
        </Link>
        <Link to="/" className="b-brand">
          <span className="b-title">{SERVICE_NAME}</span>
        </Link>
        <LockButton className="gate-lock-mobile d-lg-none" />
      </div>
      <div style={{ justifyContent: 'end' }} className={collapseClass.join(' ')}>
        <NavRight />
      </div>
    </React.Fragment>
  );

  return (
    <React.Fragment>
      <header className={headerClass.join(' ')} style={{ zIndex: 1009 }}>
        {navBar}
      </header>
    </React.Fragment>
  );
};

export default NavBar;
