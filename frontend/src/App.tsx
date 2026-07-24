import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import { loadConditions } from './api/conditionsApi';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { DiceDialogProvider } from './contexts/DiceDialogContext';
import { ChoiceDialogProvider } from './contexts/ChoiceDialogContext';
import { ReactionPromptProvider } from './contexts/ReactionPromptContext';
import { PinModeProvider } from './hooks/usePinMode';
import { EntityDetailProvider } from './components/EntityDetailProvider';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import NotFound from './pages/NotFound';
import MobileSuggestion from './mobile/MobileSuggestion';

// Ленивая загрузка страниц (code-splitting по роутам) — уменьшает основной чанк.
const Settings = lazy(() => import('./pages/Settings'));
const CardLibrary = lazy(() => import('./pages/CardLibrary'));
const CardCreator = lazy(() => import('./pages/CardCreator'));
const CardExport = lazy(() => import('./pages/CardExport'));
const WeaponTemplates = lazy(() => import('./pages/WeaponTemplates'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Groups = lazy(() => import('./pages/Groups'));
const CreateGroup = lazy(() => import('./pages/CreateGroup'));
const JoinGroup = lazy(() => import('./pages/JoinGroup'));
const GroupDetail = lazy(() => import('./pages/GroupDetail'));
const Inventory = lazy(() => import('./pages/Inventory'));
const CreateInventory = lazy(() => import('./pages/CreateInventory'));
const InventoryDetail = lazy(() => import('./pages/InventoryDetail'));
const AddItemToInventory = lazy(() => import('./pages/AddItemToInventory'));
const CharacterForge = lazy(() => import('./pages/CharacterForge'));
const CharacterSheetMVP = lazy(() => import('./pages/CharacterSheetMVP'));
const CharactersForgeList = lazy(() => import('./pages/CharactersForgeList'));
const InitiativeTracker = lazy(() => import('./pages/InitiativeTracker'));
const CardTypeSelection = lazy(() => import('./pages/CardTypeSelection'));
const WeaponSelection = lazy(() => import('./pages/WeaponSelection'));
const EquipmentSelection = lazy(() => import('./pages/EquipmentSelection'));
const PotionSelection = lazy(() => import('./pages/PotionSelection'));
const IngredientSelection = lazy(() => import('./pages/IngredientSelection'));
const TrinketSelection = lazy(() => import('./pages/TrinketSelection'));
const ShopNew = lazy(() => import('./pages/ShopNew'));
const ShopDetail = lazy(() => import('./pages/ShopDetail'));
const ActionCreator = lazy(() => import('./pages/ActionCreator'));
const EffectCreator = lazy(() => import('./pages/EffectCreator'));
const SpellCreator = lazy(() => import('./pages/SpellCreator'));
const SpellPage = lazy(() => import('./pages/SpellPage'));
const FeatCreator = lazy(() => import('./pages/FeatCreator'));
const BackgroundCreator = lazy(() => import('./pages/BackgroundCreator'));
const RaceCreator = lazy(() => import('./pages/RaceCreator'));
const ClassCreator = lazy(() => import('./pages/ClassCreator'));
const ResourceCreator = lazy(() => import('./pages/ResourceCreator'));
const VariableCreator = lazy(() => import('./pages/VariableCreator'));
const ConceptCreator = lazy(() => import('./pages/ConceptCreator'));
const ImageStudio = lazy(() => import('./pages/ImageStudio'));
const MechanicsGuide = lazy(() => import('./pages/MechanicsGuide'));
const EncounterList = lazy(() => import('./pages/EncounterList'));
const EncounterBoard = lazy(() => import('./pages/EncounterBoard'));
const MobileCharactersPage = lazy(() => import('./mobile/MobileCharactersPage'));
const MobileCharacterSheet = lazy(() => import('./mobile/MobileCharacterSheet'));
const MobileCharacterWizard = lazy(() => import('./mobile/MobileCharacterWizard'));
const MobileEntityCatalog = lazy(() => import('./mobile/MobileEntityCatalog'));

function App() {
  // Догрузить состояния из БД в реестр движка (фаза D); фолбэк — встроенные 13.
  useEffect(() => { loadConditions(); }, []);
  const location = useLocation();
  return (
    <AuthProvider>
      <ToastProvider>
        <DiceDialogProvider>
        <ChoiceDialogProvider>
        <ReactionPromptProvider>
        <PinModeProvider>
        <EntityDetailProvider>
        <ErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<div style={{ padding: '60px 24px', textAlign: 'center', color: '#a59886' }}>Загрузка…</div>}>
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

        {/* Отдельный мобильный интерфейс игрока */}
        <Route path="/m" element={<Navigate to="/m/characters" replace />} />
        <Route path="/m/characters" element={<MobileCharactersPage />} />
        <Route path="/m/characters/new" element={<MobileCharacterWizard />} />
        <Route path="/m/characters/:id" element={<MobileCharacterSheet />} />
        <Route path="/m/characters/:id/edit" element={<MobileCharacterWizard />} />
        <Route path="/m/characters/:id/level-up" element={<MobileCharacterWizard />} />
        <Route path="/m/characters/:id/add" element={<MobileEntityCatalog />} />
        <Route path="/m/characters/:id/add/:type" element={<MobileEntityCatalog />} />

        {/* Защищенные маршруты */}
        <Route path="/" element={
          <ProtectedRoute>
            <Layout>
              <CardLibrary />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/docs/mechanics" element={
          <ProtectedRoute>
            <Layout>
              <MechanicsGuide />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/encounters" element={
          <ProtectedRoute>
            <Layout>
              <EncounterList />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/encounter/:id" element={
          <ProtectedRoute>
            <Layout>
              <EncounterBoard />
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

        {/* Любой неизвестный URL — страница «не найдено» (иначе белый экран) */}
        <Route path="*" element={<NotFound />} />
      </Routes>
        <MobileSuggestion />
        </Suspense>
        </ErrorBoundary>
        </EntityDetailProvider>
        </PinModeProvider>
        </ReactionPromptProvider>
        </ChoiceDialogProvider>
        </DiceDialogProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
