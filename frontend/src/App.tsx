import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
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
import Characters from './pages/Characters';
import CharacterDetail from './pages/CharacterDetail';
import CharacterEdit from './pages/CharacterEdit';
import CreateCharacter from './pages/CreateCharacter';
import CharactersV2 from './pages/CharactersV2';
import CharacterDetailV2 from './pages/CharacterDetailV2';
import CharactersV3 from './pages/CharactersV3';
import CharacterDetailV3 from './pages/CharacterDetailV3';
import CreateCharacterV3 from './pages/CreateCharacterV3';
import DiceRoller from './pages/DiceRoller';
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

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
        {/* Публичные маршруты */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        
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
        
        {/* Character routes */}
        <Route path="/characters" element={
          <ProtectedRoute>
            <Layout>
              <Characters />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/characters-v2" element={
          <ProtectedRoute>
            <Layout>
              <CharactersV2 />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/characters-v2/:id" element={
          <ProtectedRoute>
            <Layout>
              <CharacterDetailV2 />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/characters-v2/:id/edit" element={
          <ProtectedRoute>
            <Layout>
              <CharacterDetailV2 />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/characters-v3" element={
          <ProtectedRoute>
            <Layout>
              <CharactersV3 />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/characters-v3/create" element={
          <ProtectedRoute>
            <Layout>
              <CreateCharacterV3 />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/characters-v3/:id" element={
          <ProtectedRoute>
            <Layout>
              <CharacterDetailV3 />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/characters-v3/:id/edit" element={
          <ProtectedRoute>
            <Layout>
              <CharacterDetailV3 />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/characters/create" element={
          <ProtectedRoute>
            <Layout>
              <CreateCharacter />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/characters/:id" element={
          <ProtectedRoute>
            <Layout>
              <CharacterDetail />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/characters/:id/edit" element={
          <ProtectedRoute>
            <Layout>
              <CharacterEdit />
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

        {/* Effect routes */}
        <Route path="/effect-creator" element={
          <ProtectedRoute>
            <Layout>
              <EffectCreator />
            </Layout>
          </ProtectedRoute>
        } />
      </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
