import './UtilityPages.css';
import React from 'react';
import WeaponSelector from '../components/WeaponSelector';

const WeaponSelection: React.FC = () => {
  return (
    <div className="site-page-theme utility-selection-page utility-selection-page--weapon">
      <WeaponSelector />
    </div>
  );
};

export default WeaponSelection;
