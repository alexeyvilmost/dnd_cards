import './UtilityPages.css';
import React from 'react';
import TrinketSelector from '../components/TrinketSelector';

const TrinketSelection: React.FC = () => {
  return (
    <div className="site-page-theme utility-selection-page utility-selection-page--categories">
      <TrinketSelector />
    </div>
  );
};

export default TrinketSelection;
