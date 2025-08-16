import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import CardLibrary from './pages/CardLibrary';
import CardCreator from './pages/CardCreator';
import CardEditor from './pages/CardEditor';
import CardExport from './pages/CardExport';

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<CardLibrary />} />
        <Route path="/create" element={<CardCreator />} />
        <Route path="/edit/:id" element={<CardEditor />} />
        <Route path="/export" element={<CardExport />} />
      </Routes>
    </Layout>
  );
}

export default App;
