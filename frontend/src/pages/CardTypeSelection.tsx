import './UtilityPages.css';
import React from 'react';
import CardTypeSelector from '../components/CardTypeSelector';

const CardTypeSelection: React.FC = () => {
  return (
    <div className="site-page-theme utility-selection-page utility-selection-page--types">
      <CardTypeSelector />
    </div>
  );
};

export default CardTypeSelection;
