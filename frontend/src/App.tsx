import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
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

function App() {
  return (
    <AuthProvider>
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
              <CardCreator />
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
      </Routes>
    </AuthProvider>
  );
}

export default App;
