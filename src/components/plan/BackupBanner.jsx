import React from 'react';
import { Link } from 'react-router-dom';

// react-bootstrap
import { Alert } from 'react-bootstrap';

// project import
import { useAppData } from '../../state/AppDataContext';
import { diffDays } from '../../lib/dates';

// ==============================|| BACKUP BANNER ||============================== //

export const BACKUP_REMIND_DAYS = 14;

const BackupBanner = () => {
  const { meta, hasData, today } = useAppData();
  if (!hasData) return null;
  const last = meta.lastBackupAt ? meta.lastBackupAt.slice(0, 10) : null;
  if (last && diffDays(today, last) < BACKUP_REMIND_DAYS) return null;
  return (
    <Alert variant="warning" className="py-2 small">
      {last ? `마지막 백업이 ${diffDays(today, last)}일 전입니다.` : '아직 백업하지 않았습니다.'} 데이터는 이 기기에만 저장되니{' '}
      <Link to="/settings">설정</Link>에서 백업 파일이나 공유 코드를 만들어 두세요.
    </Alert>
  );
};

export default BackupBanner;
