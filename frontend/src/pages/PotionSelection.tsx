import './UtilityPages.css';
import React from 'react';
import PotionSelector from '../components/PotionSelector';

const PotionSelection: React.FC = () => {
  return (
    <div className="site-page-theme utility-selection-page utility-selection-page--categories">
      <PotionSelector />
    </div>
  );
};

export default PotionSelection;
