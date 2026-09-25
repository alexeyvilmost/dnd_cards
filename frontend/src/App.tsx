import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import AudioDirector from './audio/AudioDirector';
import {
  loadConditions,
  MICRO_MVP_CONDITION_CERTIFICATION_VERSION,
  type ConditionLoadResult,
} from './api/conditionsApi';
import {
  PINNED_MICRO_MVP_CONDITION_RELEASE_CONTENT_HASH,
  PINNED_MICRO_MVP_CONDITION_RELEASE_HASH,
  PINNED_MICRO_MVP_CONDITION_RULES_HASH,
} from './canon/microMvpL1ReleaseIdentity';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { DiceDialogProvider } from './contexts/DiceDialogContext';
import { ChoiceDialogProvider } from './contexts/ChoiceDialogContext';
import { ReactionPromptProvider } from './contexts/ReactionPromptContext';
import { PinModeProvider } from './hooks/usePinMode';
import { EntityDetailProvider } from './components/EntityDetailProvider';
import { CharacterFormulaRoot } from './contexts/CharacterFormulaContext';
import Layout from './components/Layout';
import AuthenticatedSectionGate from './components/AuthenticatedSectionGate';
import ProtectedRoute from './components/ProtectedRoute';
import ContentEditorGate from './components/ContentEditorGate';
import NotFound from './pages/NotFound';
import MobileSuggestion from './mobile/MobileSuggestion';
import CharacterV3AccessNotice from './components/CharacterV3AccessNotice';

// Ленивая загрузка страниц (code-splitting по роутам) — уменьшает основной чанк.
const Settings = lazy(() => import('./pages/Settings'));
const CardLibrary = lazy(() => import('./pages/CardLibrary'));
const HomePage = lazy(() => import('./pages/HomePage'));
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
const PaperSheetEntry = lazy(() => import('./pages/PaperSheetEntry'));
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
const PassiveCreator = lazy(() => import('./pages/PassiveCreator'));
const SpellCreator = lazy(() => import('./pages/SpellCreator'));
const EntityPage = lazy(() => import('./pages/EntityPage'));
const FeatCreator = lazy(() => import('./pages/FeatCreator'));
const BackgroundCreator = lazy(() => import('./pages/BackgroundCreator'));
const RaceCreator = lazy(() => import('./pages/RaceCreator'));
const ClassCreator = lazy(() => import('./pages/ClassCreator'));
const ResourceCreator = lazy(() => import('./pages/ResourceCreator'));
const VariableCreator = lazy(() => import('./pages/VariableCreator'));
const ConceptCreator = lazy(() => import('./pages/ConceptCreator'));
const ImageStudio = lazy(() => import('./pages/ImageStudio'));
const MechanicsGuide = lazy(() => import('./pages/MechanicsGuide'));
const EngineGuide = lazy(() => import('./pages/EngineGuide'));
const EncounterList = lazy(() => import('./pages/EncounterList'));
const EncounterBoard = lazy(() => import('./pages/EncounterBoard'));
const MobileCharactersPage = lazy(() => import('./mobile/MobileCharactersPage'));
const MobileCharacterSheet = lazy(() => import('./mobile/MobileCharacterSheet'));
const MobileCharacterWizard = lazy(() => import('./mobile/MobileCharacterWizard'));
const MobileEntityCatalog = lazy(() => import('./mobile/MobileEntityCatalog'));
const RulesLab = lazy(() => import('./pages/RulesLab'));
const MonsterLibrary = lazy(() => import('./pages/MonsterLibrary'));
const MonsterCreator = lazy(() => import('./pages/MonsterCreator'));
const SoloCombatPage = lazy(() => import('./pages/SoloCombatPage'));
const RoguelikePage = lazy(() => import('./pages/RoguelikePage'));
const RULE_BOOTSTRAP_TIMEOUT_MS = 15_000;
const RULE_BOOTSTRAP_RETRY_MS = 5_000;
const CONDITION_RELEASE_BINDING = Object.freeze({
  certificationVersion: MICRO_MVP_CONDITION_CERTIFICATION_VERSION,
  rulesHash: PINNED_MICRO_MVP_CONDITION_RULES_HASH,
  releaseContentHash: PINNED_MICRO_MVP_CONDITION_RELEASE_CONTENT_HASH,
  releaseHash: PINNED_MICRO_MVP_CONDITION_RELEASE_HASH,
});

function RulesAuthorityBoundary({ ready, children }: { ready: boolean; children: ReactNode }) {
  if (ready) return <>{children}</>;
  return (
    <div role="status" aria-live="polite" style={{ padding: '60px 24px', textAlign: 'center', color: '#a59886' }}>
      Проверяем правила для игрового экрана…
    </div>
  );
}

function App() {
  const location = useLocation();
  const isRulesLab = location.pathname === '/rules-lab'
    || location.pathname.startsWith('/rules-lab/');
  const isPaperSheet = /^\/paper-sheet(?:\/[^/]+)?\/?$/.test(location.pathname);
  const isHome = location.pathname === '/';
  const [conditionsReady, setConditionsReady] = useState(false);
  const [conditionAuthority, setConditionAuthority] = useState<ConditionLoadResult | null>(null);
  const conditionLoadRef = useRef<ReturnType<typeof loadConditions> | null>(null);
  // Активировать только полный сертифицированный набор из 15 состояний БД;
  // при любой неполноте движок явно остаётся в offline-fixture режиме и
  // автоматически повторяет bootstrap. Временный cold start backend не должен
  // оставлять вкладку в offline-режиме до ручной перезагрузки.
  useEffect(() => {
    if (isRulesLab || isPaperSheet || isHome) return undefined;
    let active = true;
    let retryTimer: number | undefined;
    setConditionsReady(false);
    const bootstrap = () => {
      conditionLoadRef.current ??= loadConditions({
        timeoutMs: RULE_BOOTSTRAP_TIMEOUT_MS,
        expectedRelease: CONDITION_RELEASE_BINDING,
      });
      void conditionLoadRef.current
        .then((result) => {
          if (!active) return;
          setConditionAuthority(result);
          setConditionsReady(true);
          if (result.mode === 'offline_fixture') {
            conditionLoadRef.current = null;
            retryTimer = window.setTimeout(bootstrap, RULE_BOOTSTRAP_RETRY_MS);
          }
        })
        .catch(() => {
          // `loadConditions` is fail-closed itself. Keep the shell safe even if
          // a future adapter unexpectedly rejects instead of returning a mode.
          if (!active) return;
          setConditionAuthority({
            mode: 'offline_fixture',
            reason: 'condition authority bootstrap failed',
          });
          setConditionsReady(true);
          conditionLoadRef.current = null;
          retryTimer = window.setTimeout(bootstrap, RULE_BOOTSTRAP_RETRY_MS);
        });
    };
    bootstrap();
    return () => {
      active = false;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [isRulesLab, isPaperSheet, isHome]);

  // Acceptance lab deliberately has no API/auth dependency or application-wide providers.
  if (isRulesLab) {
    return (
      <ErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<div style={{ padding: '60px 24px', textAlign: 'center', color: '#a59886' }}>Загрузка…</div>}>
          <Routes>
            <Route path="/rules-lab/:scenarioId?" element={<RulesLab />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    );
  }

  // The paper editor has its own document storage, independent of game-rule authority.
  // Reuse the catalog's previews and detail host without bootstrapping game rules.
  if (isPaperSheet) {
    return (
      <AuthProvider>
        <ErrorBoundary resetKey={location.pathname}>
          <CharacterFormulaRoot>
            <PinModeProvider>
              <EntityDetailProvider readOnly>
                <Suspense fallback={<div style={{ padding: '60px 24px', textAlign: 'center' }}>Загрузка листа…</div>}>
                  <Routes>
                    <Route path="/paper-sheet/:id?" element={<Layout><PaperSheetEntry /></Layout>} />
                  </Routes>
                </Suspense>
              </EntityDetailProvider>
            </PinModeProvider>
          </CharacterFormulaRoot>
        </ErrorBoundary>
      </AuthProvider>
    );
  }

  const withRulesAuthority = (children: ReactNode) => (
    <RulesAuthorityBoundary ready={conditionsReady}>{children}</RulesAuthorityBoundary>
  );

  return (
    <>
    {!isHome && conditionAuthority?.mode === 'offline_fixture' && (
      <div
        role="status"
        data-testid="offline-rules-authority"
        style={{
          position: 'sticky', top: 0, zIndex: 10000, padding: '8px 16px',
          textAlign: 'center', color: '#2f2418', background: '#f3d28b',
          pointerEvents: 'none',
        }}
      >
        Офлайн-набор правил: сертифицированные данные сервера сейчас недоступны.{' '}
        Повторяем подключение автоматически.
        {conditionAuthority.reason && (
          <span aria-description={conditionAuthority.reason}> Причина: {conditionAuthority.reason}</span>
        )}
      </div>
    )}
    <AuthProvider>
      <AudioDirector/>
      <ToastProvider>
        <CharacterV3AccessNotice />
        <CharacterFormulaRoot>
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

        {/* CharacterV3 хранит личные листы/журналы и требует валидную сессию. */}
        <Route path="/character-forge" element={<ProtectedRoute>{withRulesAuthority(<CharacterForge />)}</ProtectedRoute>} />
        <Route path="/character-forge/:id" element={<ProtectedRoute>{withRulesAuthority(<CharacterForge />)}</ProtectedRoute>} />
        <Route path="/characters-forge" element={<AuthenticatedSectionGate section="characters"><Layout><CharactersForgeList /></Layout></AuthenticatedSectionGate>} />
        <Route path="/spell/:id" element={<Layout><EntityPage fixedType="spells" /></Layout>} />
        <Route path="/entity/:type/:id" element={<Layout><EntityPage /></Layout>} />
        <Route path="/characters-v3/:id" element={<ProtectedRoute>{withRulesAuthority(<Layout workspace><CharacterSheetMVP /></Layout>)}</ProtectedRoute>} />
        <Route path="/characters-v3/:id/combat" element={<ProtectedRoute>{withRulesAuthority(<Layout workspace><SoloCombatPage /></Layout>)}</ProtectedRoute>} />
        <Route path="/roguelike" element={<AuthenticatedSectionGate section="runs">{withRulesAuthority(<Layout><RoguelikePage /></Layout>)}</AuthenticatedSectionGate>} />
        <Route path="/roguelike/:id" element={<AuthenticatedSectionGate section="runs">{withRulesAuthority(<Layout><RoguelikePage /></Layout>)}</AuthenticatedSectionGate>} />

        {/* Отдельный мобильный интерфейс игрока */}
        <Route path="/m" element={<Navigate to="/m/characters" replace />} />
        <Route path="/m/characters" element={<ProtectedRoute><MobileCharactersPage /></ProtectedRoute>} />
        <Route path="/m/characters/new" element={<ProtectedRoute>{withRulesAuthority(<MobileCharacterWizard />)}</ProtectedRoute>} />
        <Route path="/m/characters/:id" element={<ProtectedRoute>{withRulesAuthority(<MobileCharacterSheet />)}</ProtectedRoute>} />
        <Route path="/m/characters/:id/edit" element={<ProtectedRoute>{withRulesAuthority(<MobileCharacterWizard />)}</ProtectedRoute>} />
        <Route path="/m/characters/:id/level-up" element={<ProtectedRoute>{withRulesAuthority(<MobileCharacterWizard />)}</ProtectedRoute>} />
        <Route path="/m/characters/:id/add" element={<ProtectedRoute>{withRulesAuthority(<MobileEntityCatalog />)}</ProtectedRoute>} />
        <Route path="/m/characters/:id/add/:type" element={<ProtectedRoute>{withRulesAuthority(<MobileEntityCatalog />)}</ProtectedRoute>} />

        {/* Защищенные маршруты */}
        <Route path="/" element={<HomePage />} />
        <Route path="/library" element={<Layout><CardLibrary /></Layout>} />
        <Route path="/docs/mechanics" element={
          <ProtectedRoute>
            <Layout>
              <MechanicsGuide />
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/docs/engine" element={
          <ProtectedRoute>
            <Layout>
              <EngineGuide />
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
            {withRulesAuthority(<Layout><EncounterBoard /></Layout>)}
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
              <ContentEditorGate kind="cards"><CardCreator /></ContentEditorGate>
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
        <Route path="/characters-v3/:id/edit" element={<ProtectedRoute>{withRulesAuthority(<CharacterForge />)}</ProtectedRoute>} />
        
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
            {withRulesAuthority(<Layout><InitiativeTracker /></Layout>)}
          </ProtectedRoute>
        } />

        <Route path="/monsters" element={
          <Layout><MonsterLibrary /></Layout>
        } />
        <Route path="/monster-forge" element={
          <ProtectedRoute><ContentEditorGate kind="monsters"><Layout><MonsterCreator /></Layout></ContentEditorGate></ProtectedRoute>
        } />
        <Route path="/monster-forge/:id" element={
          <ProtectedRoute><ContentEditorGate kind="monsters"><Layout><MonsterCreator /></Layout></ContentEditorGate></ProtectedRoute>
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
              <ContentEditorGate kind="actions"><ActionCreator /></ContentEditorGate>
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/resource-creator" element={
          <ProtectedRoute>
            <Layout>
              <ContentEditorGate kind="resources"><ResourceCreator /></ContentEditorGate>
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/variable-creator" element={
          <ProtectedRoute>
            <Layout>
              <ContentEditorGate kind="variables"><VariableCreator /></ContentEditorGate>
            </Layout>
          </ProtectedRoute>
        } />

        <Route path="/concept-creator" element={
          <ProtectedRoute>
            <Layout>
              <ContentEditorGate kind="concepts"><ConceptCreator /></ContentEditorGate>
            </Layout>
          </ProtectedRoute>
        } />

        {/* Effect routes */}
        <Route path="/passive-creator" element={<ProtectedRoute><ContentEditorGate kind="passives"><Layout><PassiveCreator/></Layout></ContentEditorGate></ProtectedRoute>}/>
        <Route path="/effect-creator" element={
          <ProtectedRoute>
            <Layout>
              <ContentEditorGate kind="effects"><EffectCreator /></ContentEditorGate>
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
              <ContentEditorGate kind="spells"><SpellCreator /></ContentEditorGate>
            </Layout>
          </ProtectedRoute>
        } />

        {/* Feat routes */}
        <Route path="/feat-creator" element={
          <ProtectedRoute>
            <Layout>
              <ContentEditorGate kind="feats"><FeatCreator /></ContentEditorGate>
            </Layout>
          </ProtectedRoute>
        } />

        {/* Background routes */}
        <Route path="/background-creator" element={
          <ProtectedRoute>
            <Layout>
              <ContentEditorGate kind="backgrounds"><BackgroundCreator /></ContentEditorGate>
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/race-creator" element={
          <ProtectedRoute>
            <Layout>
              <ContentEditorGate kind="races"><RaceCreator /></ContentEditorGate>
            </Layout>
          </ProtectedRoute>
        } />
        <Route path="/class-creator" element={
          <ProtectedRoute>
            <Layout>
              <ContentEditorGate kind="classes"><ClassCreator /></ContentEditorGate>
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
        </CharacterFormulaRoot>
      </ToastProvider>
    </AuthProvider>
    </>
  );
}

export default App;
