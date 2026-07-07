import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { loadConditions } from './api/conditionsApi';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { DiceDialogProvider } from './contexts/DiceDialogContext';
import { ReactionPromptProvider } from './contexts/ReactionPromptContext';
import { PinModeProvider } from './hooks/usePinMode';
import { EntityDetailProvider } from './components/EntityDetailProvider';
import Settings from './pages/Settings';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import CardLibrary from './pages/CardLibrary';
import CardCreator from './pages/CardCreator';
import CardExport from './pages/CardExport';
import WeaponTemplates from './pages/WeaponTemplates';
import Login from './pages/Login';
import Register from './pages/Register';
import Groups from './pages/Groups';
import CreateGroup from './pages/CreateGroup';
import JoinGroup from './pages/JoinGroup';
import GroupDetail from './pages/GroupDetail';
import Inventory from './pages/Inventory';
import CreateInventory from './pages/CreateInventory';
import InventoryDetail from './pages/InventoryDetail';
import AddItemToInventory from './pages/AddItemToInventory';
import CharacterForge from './pages/CharacterForge';
import CharacterSheetMVP from './pages/CharacterSheetMVP';
import CharactersForgeList from './pages/CharactersForgeList';
import DiceRoller from './pages/DiceRoller';
import DiceTest from './pages/DiceTest';
import InitiativeTracker from './pages/InitiativeTracker';
import CardTypeSelection from './pages/CardTypeSelection';
import WeaponSelection from './pages/WeaponSelection';
import EquipmentSelection from './pages/EquipmentSelection';
import PotionSelection from './pages/PotionSelection';
import IngredientSelection from './pages/IngredientSelection';
import TrinketSelection from './pages/TrinketSelection';
import ShopNew from './pages/ShopNew';
import ShopDetail from './pages/ShopDetail';
import ActionCreator from './pages/ActionCreator';
import EffectCreator from './pages/EffectCreator';
import SpellCreator from './pages/SpellCreator';
import SpellPage from './pages/SpellPage';
import FeatCreator from './pages/FeatCreator';
import BackgroundCreator from './pages/BackgroundCreator';
import RaceCreator from './pages/RaceCreator';
import ClassCreator from './pages/ClassCreator';
import ResourceCreator from './pages/ResourceCreator';
import VariableCreator from './pages/VariableCreator';
import ConceptCreator from './pages/ConceptCreator';
import ImageStudio from './pages/ImageStudio';

function App() {
  // Догрузить состояния из БД в реестр движка (фаза D); фолбэк — встроенные 13.
  useEffect(() => { loadConditions(); }, []);
  return (
    <AuthProvider>
      <ToastProvider>
        <DiceDialogProvider>
        <ReactionPromptProvider>
        <PinModeProvider>
        <EntityDetailProvider>
        <Routes>
        {/* Публичные маршруты */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Конструктор персонажа (без авторизации, полноэкранный) */}
        <Route path="/character-forge" element={<CharacterForge />} />
        <Route path="/character-forge/:id" element={<CharacterForge />} />
        <Route path="/characters-forge" element={<CharactersForgeList />} />
        <Route path="/spell/:id" element={<SpellPage />} />
        <Route path="/characters-v3/:id" element={<CharacterSheetMVP />} />

        {/* Защищенные маршруты */}
        <Route path="/" element={
          <ProtectedRoute>
            <Layout>
              <CardLibrary />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/create" element={
          <ProtectedRoute>
            <Layout>
              <CardTypeSelection />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/card-creator" element={
          <ProtectedRoute>
            <Layout>
              <CardCreator />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/edit/:id" element={
          <ProtectedRoute>
            <Layout>
              <CardCreator />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/export" element={
          <ProtectedRoute>
            <Layout>
              <CardExport />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/templates" element={
          <ProtectedRoute>
            <Layout>
              <WeaponTemplates />
            </Layout>
          </ProtectedRoute>
        } />
        
        {/* Card creation routes */}
        <Route path="/card-creator/weapon" element={
          <ProtectedRoute>
            <Layout>
              <WeaponSelection />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/card-creator/equipment" element={
          <ProtectedRoute>
            <Layout>
              <EquipmentSelection />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/card-creator/potion" element={
          <ProtectedRoute>
            <Layout>
              <PotionSelection />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/card-creator/ingredient" element={
          <ProtectedRoute>
            <Layout>
              <IngredientSelection />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/card-creator/trinket" element={
          <ProtectedRoute>
            <Layout>
              <TrinketSelection />
            </Layout>
          </ProtectedRoute>
        } />
        
        {/* Group routes */}
        <Route path="/groups" element={
          <ProtectedRoute>
            <Layout>
              <Groups />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/groups/create" element={
          <ProtectedRoute>
            <Layout>
              <CreateGroup />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/groups/join" element={
          <ProtectedRoute>
            <Layout>
              <JoinGroup />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/groups/:id" element={
          <ProtectedRoute>
            <Layout>
              <GroupDetail />
            </Layout>
          </ProtectedRoute>
        } />
        
        {/* Inventory routes */}
        <Route path="/inventory" element={
          <ProtectedRoute>
            <Layout>
              <Inventory />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/inventory/create" element={
          <ProtectedRoute>
            <Layout>
              <CreateInventory />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/inventory/:id" element={
          <ProtectedRoute>
            <Layout>
              <InventoryDetail />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/inventory/:id/add-item" element={
          <ProtectedRoute>
            <Layout>
              <AddItemToInventory />
            </Layout>
          </ProtectedRoute>
        } />
        
        {/* Character routes: легаси-поколения (v1/v2/v3-old) удалены 2026-07-05,
            старые URL ведут в актуальную систему (Forge). */}
        <Route path="/characters" element={<Navigate to="/characters-forge" replace />} />
        <Route path="/characters-v2" element={<Navigate to="/characters-forge" replace />} />
        <Route path="/characters-v3" element={<Navigate to="/characters-forge" replace />} />
        <Route path="/characters-v3/create" element={<Navigate to="/character-forge" replace />} />
        <Route path="/characters/create" element={<Navigate to="/character-forge" replace />} />
        <Route path="/characters-v3/:id/edit" element={<CharacterForge />} />
        
        {/* Настройки сайта */}
        <Route path="/settings" element={
          <ProtectedRoute>
            <Layout>
              <Settings />
            </Layout>
          </ProtectedRoute>
        } />

        {/* Dice Roller route */}
        <Route path="/dice" element={
          <ProtectedRoute>
            <Layout>
              <DiceRoller />
            </Layout>
          </ProtectedRoute>
        } />
        
        {/* Dice Test route */}
        <Route path="/dice-test" element={
          <ProtectedRoute>
            <Layout>
              <DiceTest />
            </Layout>
          </ProtectedRoute>
        } />

        <Route path="/initiative" element={
          <ProtectedRoute>
            <Layout>
              <InitiativeTracker />
            </Layout>
          </ProtectedRoute>
        } />

        {/* Shop routes */}
        <Route path="/shop/new" element={
          <ProtectedRoute>
            <Layout>
              <ShopNew />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/shop/:slug" element={
          <ProtectedRoute>
            <Layout>
              <ShopDetail />
            </Layout>
          </ProtectedRoute>
        } />

        {/* Action routes */}
        <Route path="/action-creator" element={
          <ProtectedRoute>
            <Layout>
              <ActionCreator />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/resource-creator" element={
          <ProtectedRoute>
            <Layout>
              <ResourceCreator />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/variable-creator" element={
          <ProtectedRoute>
            <Layout>
              <VariableCreator />
            </Layout>
          </ProtectedRoute>
        } />

        <Route path="/concept-creator" element={
          <ProtectedRoute>
            <Layout>
              <ConceptCreator />
            </Layout>
          </ProtectedRoute>
        } />

        {/* Effect routes */}
        <Route path="/effect-creator" element={
          <ProtectedRoute>
            <Layout>
              <EffectCreator />
            </Layout>
          </ProtectedRoute>
        } />

        {/* Image generation studio */}
        <Route path="/image-generator" element={
          <ProtectedRoute>
            <Layout>
              <ImageStudio />
            </Layout>
          </ProtectedRoute>
        } />

        {/* Spell routes */}
        <Route path="/spell-creator" element={
          <ProtectedRoute>
            <Layout>
              <SpellCreator />
            </Layout>
          </ProtectedRoute>
        } />

        {/* Feat routes */}
        <Route path="/feat-creator" element={
          <ProtectedRoute>
            <Layout>
              <FeatCreator />
            </Layout>
          </ProtectedRoute>
        } />

        {/* Background routes */}
        <Route path="/background-creator" element={
          <ProtectedRoute>
            <Layout>
              <BackgroundCreator />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/race-creator" element={
          <ProtectedRoute>
            <Layout>
              <RaceCreator />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/class-creator" element={
          <ProtectedRoute>
            <Layout>
              <ClassCreator />
            </Layout>
          </ProtectedRoute>
        } />
      </Routes>
        </EntityDetailProvider>
        </PinModeProvider>
        </ReactionPromptProvider>
        </DiceDialogProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
