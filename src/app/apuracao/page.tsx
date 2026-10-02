"use client";

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/app/lib/supabase';
import { cidadeAtual } from '@/app/lib/cidades';
import type { ControleZona8 } from '@/app/lib/zona8';

type Voto = {
  id: number;
  numero: number | null;
  nome: string;
  chapa: string;
  cor: string;
  tipo: 'válido' | 'branco' | 'nulo';
  data_hora: string;
};

export default function ApuracaoPage() {
  const [votos, setVotos] = useState<Voto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [controleZona8, setControleZona8] = useState<ControleZona8 | null>(null);
  const [erroZona8, setErroZona8] = useState('');
  const [processandoZona8, setProcessandoZona8] = useState(false);

  const carregarVotos = async () => {
    if (!supabase) {
      setErro('Supabase não configurado.');
      setCarregando(false);
      return;
    }
    const consulta = supabase.from('votos').select('*').eq('cidade_slug', cidadeAtual()).order('data_hora', { ascending: true });
    const resultado = await Promise.race([
      consulta,
      new Promise<{ data: null; error: { message: string } }>(resolve => window.setTimeout(() => resolve({ data: null, error: { message: 'O Supabase demorou para responder. Verifique a conexão e tente novamente.' } }), 10000)),
    ]);
    const { data, error } = resultado;
    if (error) setErro(error.message);
    else setVotos(data || []);
    setCarregando(false);
  };

  const carregarZona8 = async () => {
    if (!supabase || cidadeAtual() !== 'jatai') return;

    const { data, error } = await supabase
      .from('controle_apuracao')
      .select('*')
      .eq('cidade_slug', 'jatai')
      .maybeSingle();

    if (error) {
      setControleZona8(null);
      setErroZona8(error.message);
      return;
    }

    if (!data) {
      setControleZona8(null);
      setErroZona8('Registro de controle da Zona 8 não encontrado.');
      return;
    }

    setErroZona8('');
    setControleZona8(data as ControleZona8);
  };

  useEffect(() => {
    carregarVotos();
    carregarZona8();
    const timer = window.setInterval(carregarZona8, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const validos = votos.filter(voto => voto.tipo === 'válido');
  const brancos = votos.filter(voto => voto.tipo === 'branco').length;
  const nulos = votos.filter(voto => voto.tipo === 'nulo').length;
  const apuracao = useMemo(() => {
    const grupos = new Map<string, { nome: string; chapa: string; cor: string; numero: number | null; total: number }>();
    validos.forEach(voto => {
      const chave = String(voto.numero);
      const atual = grupos.get(chave) || { nome: voto.nome, chapa: voto.chapa, cor: voto.cor, numero: voto.numero, total: 0 };
      atual.total += 1;
      grupos.set(chave, atual);
    });
    return Array.from(grupos.values()).sort((a, b) => b.total - a.total);
  }, [validos]);

  const exportarCsv = () => {
    const linhas = [['Data e hora', 'Número', 'Nome', 'Chapa', 'Cor', 'Tipo'], ...votos.map(voto => [
      new Date(voto.data_hora).toLocaleString('pt-BR'), String(voto.numero || ''), voto.nome, voto.chapa, voto.cor, voto.tipo
    ])];
    const csv = linhas.map(linha => linha.map(celula => `"${celula.replaceAll('"', '""')}"`).join(';')).join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'extrato-votacao.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const finalizarZona8 = async () => {
    if (!supabase || processandoZona8 || !controleZona8) return;
    if (!window.confirm('Revelar o resultado real?\n\nA Zona 8 será equalizada e deixará de alterar a diferença entre os candidatos.')) return;

    setProcessandoZona8(true);
    const { data, error } = await supabase.rpc('finalizar_zona8', { p_cidade: 'jatai' });
    setProcessandoZona8(false);

    if (error) {
      window.alert(`Não foi possível finalizar a Zona 8: ${error.message}`);
      return;
    }

    const linha = Array.isArray(data) ? data[0] : data;
    if (linha) setControleZona8(linha as ControleZona8);
  };

  const resetarZona8 = async (pedirConfirmacao = true) => {
    if (!supabase || cidadeAtual() !== 'jatai') return;
    if (pedirConfirmacao && !window.confirm('Resetar a Zona 8 para um novo teste?')) return;

    const { data, error } = await supabase.rpc('resetar_zona8', { p_cidade: 'jatai' });
    if (error) {
      window.alert(`Não foi possível resetar a Zona 8: ${error.message}`);
      return;
    }

    const linha = Array.isArray(data) ? data[0] : data;
    if (linha) {
      setErroZona8('');
      setControleZona8(linha as ControleZona8);
    }
  };

  const zerarVotos = async () => {
    if (!window.confirm('Tem certeza que deseja apagar todos os votos?')) return;
    const confirmacao = window.prompt('Para confirmar, digite ZERAR:');
    if (confirmacao !== 'ZERAR') {
      window.alert('Operação cancelada.');
      return;
    }
    if (!supabase) return;
    const { error } = await supabase.from('votos').delete().eq('cidade_slug', cidadeAtual());
    if (error) window.alert(`Não foi possível zerar os votos: ${error.message}`);
    else {
      setVotos([]);
      if (controleZona8) await resetarZona8(false);
      window.alert('Todos os votos foram zerados.');
    }
  };

  return (
    <main style={{ minHeight: '100vh', width: '100%', background: '#f8fafc', maxWidth: 'none', margin: 0, padding: 'clamp(24px, 4vw, 48px)', fontFamily: 'Arial, sans-serif', color: '#17202a' }}><div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div><h1 style={{ marginBottom: 6 }}>Apuração dos votos</h1><p style={{ marginTop: 0 }}>Dinâmica da igreja · urna-igreja</p></div>
        <button onClick={() => { carregarVotos(); carregarZona8(); }} style={{ padding: '10px 16px', cursor: 'pointer' }}>Atualizar</button>
      </div>
      {erro && <p style={{ color: '#b42318' }}>{erro}</p>}
      {carregando ? <p>Carregando votos...</p> : <>
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, margin: '24px 0' }}>
          {[['Total', votos.length], ['Válidos', validos.length], ['Brancos', brancos], ['Nulos', nulos]].map(([titulo, total]) => <div key={String(titulo)} style={{ padding: 18, borderRadius: 10, background: '#f1f5f9' }}><small>{titulo}</small><div style={{ fontSize: 30, fontWeight: 700 }}>{total}</div></div>)}
        </section>

        {cidadeAtual() === 'jatai' && <section style={{ margin: '24px 0', padding: 20, borderRadius: 12, background: '#111827', color: '#fff' }}>
          <h2 style={{ marginTop: 0 }}>Controle da Zona 8</h2>
          <p style={{ color: '#cbd5e1' }}>A apuração acima e o CSV continuam mostrando somente votos reais. A Zona 8 afeta apenas o painel público.</p>

          {erroZona8 ? <div style={{ padding: 14, borderRadius: 8, background: '#7f1d1d', color: '#fee2e2', marginBottom: 16 }}>
            <strong>ZONA 8 NÃO ATIVA NO SUPABASE</strong>
            <div style={{ marginTop: 6 }}>Execute a migration <code>supabase/migrations/20261002_zona8_apuracao.sql</code> no SQL Editor do Supabase e depois clique em Atualizar.</div>
            <small style={{ display: 'block', marginTop: 8, opacity: .85 }}>{erroZona8}</small>
          </div> : <>
            <p>Estado: <strong>{controleZona8?.zona8_status === 'finalizada' ? 'RESULTADO REAL LIBERADO' : 'DISPUTA CONTROLADA ATIVA'}</strong></p>
            {controleZona8 && <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 18 }}>
              <span>Amarelo (12): <strong>{controleZona8.zona8_12}</strong></span>
              <span>Verde (17): <strong>{controleZona8.zona8_17}</strong></span>
              <span>Azul (67): <strong>{controleZona8.zona8_67}</strong></span>
            </div>}
            {controleZona8?.zona8_status === 'finalizada' ?
              <button onClick={() => resetarZona8(true)} style={{ padding: '12px 18px', border: 0, borderRadius: 8, cursor: 'pointer', background: '#475569', color: '#fff', fontWeight: 800 }}>RESETAR ZONA 8</button> :
              <button onClick={finalizarZona8} disabled={processandoZona8 || !controleZona8} style={{ padding: '14px 20px', border: 0, borderRadius: 8, cursor: controleZona8 ? 'pointer' : 'not-allowed', background: '#dc2626', color: '#fff', fontWeight: 900, opacity: processandoZona8 || !controleZona8 ? .6 : 1 }}>{processandoZona8 ? 'PROCESSANDO...' : 'REVELAR RESULTADO REAL'}</button>
            }
          </>}
        </section>}

        <h2>Resultado por chapa</h2>
        <div style={{ display: 'grid', gap: 12 }}>
          {apuracao.length === 0 ? <p>Nenhum voto válido registrado.</p> : apuracao.map(chapa => <div key={String(chapa.numero)} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: 16, border: '1px solid #ddd', borderRadius: 10 }}><span><strong>{chapa.numero} · {chapa.nome}</strong><br />{chapa.chapa} · {chapa.cor}</span><strong>{chapa.total} voto(s)</strong></div>)}
        </div>
        <div style={{ marginTop: 28, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><h2>Extrato detalhado</h2><div style={{ display: 'flex', gap: 10 }}><button onClick={exportarCsv} style={{ padding: '10px 16px', cursor: 'pointer' }}>Exportar CSV</button><button onClick={zerarVotos} style={{ padding: '10px 16px', cursor: 'pointer', background: '#b42318', color: '#fff', border: 0, borderRadius: 4 }}>ZERAR VOTOS</button></div></div>
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>{['Data e hora', 'Número', 'Nome', 'Chapa', 'Tipo'].map(titulo => <th key={titulo} style={{ textAlign: 'left', borderBottom: '2px solid #ddd', padding: 10 }}>{titulo}</th>)}</tr></thead><tbody>{votos.map(voto => <tr key={voto.id}>{[new Date(voto.data_hora).toLocaleString('pt-BR'), voto.numero || '-', voto.nome || '-', voto.chapa || '-', voto.tipo].map((valor, i) => <td key={i} style={{ borderBottom: '1px solid #eee', padding: 10 }}>{valor}</td>)}</tr>)}</tbody></table></div>
      </>}
      </div>
    </main>
  );
}
