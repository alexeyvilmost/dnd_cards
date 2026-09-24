import './UtilityPages.css';
import React from 'react';
import EquipmentSelector from '../components/EquipmentSelector';

const EquipmentSelection: React.FC = () => {
  return (
    <div className="site-page-theme utility-selection-page utility-selection-page--categories">
      <EquipmentSelector />
    </div>
  );
};

export default EquipmentSelection;
