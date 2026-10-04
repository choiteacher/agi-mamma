import React from 'react';

// react-bootstrap
import { ListGroup } from 'react-bootstrap';

// project import
import LockButton from '../../../../gate/LockButton';

// ==============================|| NAV RIGHT ||============================== //

// 데스크톱 헤더 오른쪽 영역 (모바일에서는 NavBar의 m-header에 같은 버튼이 있다)
const NavRight = () => {
  return (
    <ListGroup as="ul" bsPrefix=" " className="navbar-nav ml-auto">
      <ListGroup.Item as="li" bsPrefix=" ">
        <LockButton />
      </ListGroup.Item>
    </ListGroup>
  );
};

export default NavRight;
