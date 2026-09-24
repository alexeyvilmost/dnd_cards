import './UtilityPages.css';
import React from 'react';
import IngredientSelector from '../components/IngredientSelector';

const IngredientSelection: React.FC = () => {
  return (
    <div className="site-page-theme utility-selection-page utility-selection-page--categories">
      <IngredientSelector />
    </div>
  );
};

export default IngredientSelection;
