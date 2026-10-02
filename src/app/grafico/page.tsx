"use client";

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/app/lib/supabase';
import { cidadeAtual } from '@/app/lib/cidades';
import MapaIgreja from './MapaIgreja';
import { dados } from '@/app/model/dados';
import { dadosGoiania } from '@/app/model/dadosGoiania';
import { aplicarIntensidade, corHexDaChapa, obterRegiaoDoDiscipulado, regioesJatai } from '@/app/lib/regioesJatai';
import { calcularZona8Exibida, ControleZona8 } from '@/app/lib/zona8';

type Voto = { numero: number | null; nome: string; chapa: string; cor: string; tipo: string; discipulado: string | null };
type Grupo = { numero: number; nome: string; chapa: string; cor: string; total: number };
type ResultadoRegiao = { id: number; total: number; vencedorNumero: number | null; vencedorCor: string | null; vencedorVotos: number; segundoVotos: number; margem: number; corMapa: string };

const corDaChapa = (cor: string) => ({ Amarelo: '#eab308', Verde: '#22c55e', Azul: '#3b82f6', '#d7ff00': '#d7ff00', '#7cff00': '#7cff00', '#18bfff': '#18bfff' }[cor] || '#64748b');
const fotoDaChapa = (numero: number, cidade: string) => cidade === 'goiania' ? ({ 88: 'lucas-ganzerli.png', 75: 'samuel.png', 67: 'maria-eduarda.png' }[numero] || '') : ({ 12: 'lauanny.jpg', 17: 'manu.jpg', 67: 'joao-arthur.jpg' }[numero] || '');
const caminhoFoto = (cidade: string, foto: string) => cidade === 'goiania' ? `/candidatos/goiania/${foto}` : `/candidatos/igreja/${foto}`;

export default function GraficoPage() {
  const cidade = typeof window !== 'undefined' && (window.location.pathname.startsWith('/goiania/') || new URLSearchParams(window.location.search).get('cidade') === 'goiania') ? 'goiania' : 'jatai';
  const [votos, setVotos] = useState<Voto[]>([]);
  const [atualizadoEm, setAtualizadoEm] = useState(new Date());
  const [modoSuspense, setModoSuspense] = useState(false);
  const [inicioSuspense, setInicioSuspense] = useState<number | null>(null);
  const [agora, setAgora] = useState(Date.now());
  const [delayMs, setDelayMs] = useState(480000);
  const [versiculo, setVersiculo] = useState<string | null>(null);
  const [modoFaixa, setModoFaixa] = useState(false);
  const [controleZona8, setControleZona8] = useState<ControleZona8 | null>(null);
  const [agoraZona8, setAgoraZona8] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setAgoraZona8(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const parametros = new URLSearchParams(window.location.search);
    setVersiculo(parametros.get('versiculo') || null);
    setModoFaixa(parametros.get('overlay') === '1');
    const modoDemo = parametros.get('demo') === '1';
    setModoSuspense(modoDemo);
    let relogio: number | undefined;
    if (modoDemo) {
      const minutos = Math.min(10, Math.max(5, Number(parametros.get('minutos')) || 8));
      const chave = `grafico-suspense-inicio-${minutos}`;
      const salvo = window.sessionStorage.getItem(chave);
      const inicio = salvo ? Number(salvo) : Date.now();
      if (!salvo) window.sessionStorage.setItem(chave, String(inicio));
      setInicioSuspense(inicio);
      setDelayMs(minutos * 60 * 1000);
      relogio = window.setInterval(() => setAgora(Date.now()), 300000);
    }

    const cliente = supabase;
    if (!cliente) return () => { if (relogio) window.clearInterval(relogio); };

    const carregar = async () => {
      const { data } = await cliente.from('votos').select('numero,nome,chapa,cor,tipo,discipulado').eq('cidade_slug', cidadeAtual());
      const votosCarregados = (data || []) as Voto[];
      setVotos(votosCarregados);
      setAtualizadoEm(new Date());

      if (cidade === 'jatai' && !modoDemo) {
        const validosAtuais = votosCarregados.filter(voto => voto.tipo === 'válido');
        const contar = (numero: number) => validosAtuais.filter(voto => voto.numero === numero).length;
        const { data: estado, error } = await cliente.rpc('avancar_zona8', {
          p_cidade: 'jatai',
          p_real_12: contar(12),
          p_real_17: contar(17),
          p_real_67: contar(67),
        });

        if (error) {
          console.warn('Zona 8 indisponível:', error.message);
        } else if (estado) {
          const linha = Array.isArray(estado) ? estado[0] : estado;
          if (linha) setControleZona8(linha as ControleZona8);
        }
      }
    };

    carregar();
    const canal = cliente.channel('grafico-votos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'votos', filter: `cidade_slug=eq.${cidadeAtual()}` }, carregar)
      .subscribe();
    const intervalo = window.setInterval(carregar, 5000);
    return () => { cliente.removeChannel(canal); window.clearInterval(intervalo); if (relogio) window.clearInterval(relogio); };
  }, []);

  const validos = votos.filter(voto => voto.tipo === 'válido');

  const gruposReais = useMemo(() => {
    const mapa = new Map<number, { numero: number; nome: string; chapa: string; cor: string; total: number }>();
    const candidatos = (cidade === 'goiania' ? dadosGoiania : dados)[0].candidatos;
    candidatos.forEach(candidato => mapa.set(candidato.numero, { numero: candidato.numero, nome: candidato.nome, chapa: candidato.partido, cor: candidato.cor, total: 0 }));
    validos.forEach(voto => {
      if (voto.numero === null) return;
      const atual = mapa.get(voto.numero) || { numero: voto.numero, nome: voto.nome, chapa: voto.chapa, cor: voto.cor, total: 0 };
      atual.total += 1;
      mapa.set(voto.numero, atual);
    });
    return Array.from(mapa.values()).sort((a, b) => b.total - a.total || a.numero - b.numero);
  }, [cidade, validos]);

  const grupos = useMemo(() => {
    if (!modoSuspense || !inicioSuspense) return gruposReais;
    const fake: Grupo[] = cidade === 'goiania' ? [
      { numero: 88, nome: 'Lucas Ganzerli', chapa: 'Partido Braço Forte', cor: '#d7ff00', total: 12 },
      { numero: 75, nome: 'Samuel', chapa: 'Partido Avivador', cor: '#7cff00', total: 11 },
      { numero: 67, nome: 'Maria Eduarda', chapa: 'Partido Valente', cor: '#18bfff', total: 13 },
    ] : [
      { numero: 12, nome: 'Lauanny', chapa: 'Somos Um', cor: 'Amarelo', total: 12 },
      { numero: 17, nome: 'Manu', chapa: 'Filhos de Deus', cor: 'Verde', total: 11 },
      { numero: 67, nome: 'João Arthur', chapa: 'Fortes e Intensos', cor: 'Azul', total: 13 },
    ];
    const progresso = Math.min(1, Math.max(0, (agora - inicioSuspense) / delayMs));
    const transicao = Math.min(1, Math.max(0, (progresso - 0.8) / 0.2));
    const reais = new Map(gruposReais.map(grupo => [grupo.numero, grupo]));
    const totalReal = gruposReais.reduce((total, grupo) => total + grupo.total, 0);
    const ciclo = Math.floor((agora - inicioSuspense) / 300000);
    const pesosBase = [0.36, 0.33, 0.31];
    const pesos = progresso < 0.8 ? fake.map((_, index) => pesosBase[(index + ciclo) % pesosBase.length]) : fake.map(() => 1 / fake.length);
    const totalExibido = Math.max(3, Math.floor(totalReal * (0.25 + progresso * 0.75)));
    const distribuicao = fake.map((grupo, index) => ({ ...grupo, total: Math.max(1, Math.floor(totalExibido * pesos[index])) }));
    let sobra = totalExibido - distribuicao.reduce((total, grupo) => total + grupo.total, 0);
    for (let index = 0; sobra > 0; index = (index + 1) % distribuicao.length) {
      distribuicao[index].total += 1;
      sobra -= 1;
    }
    return distribuicao.map(grupo => {
      const real = reais.get(grupo.numero)?.total || 0;
      return { ...grupo, total: transicao >= 1 ? real : Math.max(1, Math.round(grupo.total * (1 - transicao) + real * transicao)) };
    });
  }, [agora, cidade, delayMs, gruposReais, inicioSuspense, modoSuspense]);

  const resultadosRegioes = useMemo<ResultadoRegiao[]>(() => {
    if (cidade !== 'jatai' || modoSuspense) return [];

    return regioesJatai.map(regiao => {
      const votosDaRegiao = validos.filter(voto => obterRegiaoDoDiscipulado(voto.discipulado) === regiao.id);
      if (!votosDaRegiao.length) return { id: regiao.id, total: 0, vencedorNumero: null, vencedorCor: null, vencedorVotos: 0, segundoVotos: 0, margem: 0, corMapa: '#334155' };

      const porChapa = new Map<number, { numero: number; cor: string; total: number }>();
      votosDaRegiao.forEach(voto => {
        if (voto.numero === null) return;
        const atual = porChapa.get(voto.numero) || { numero: voto.numero, cor: voto.cor, total: 0 };
        atual.total += 1;
        porChapa.set(voto.numero, atual);
      });

      const ranking = Array.from(porChapa.values()).sort((a, b) => b.total - a.total);
      const primeiro = ranking[0];
      const segundo = ranking[1];
      if (!primeiro) return { id: regiao.id, total: votosDaRegiao.length, vencedorNumero: null, vencedorCor: null, vencedorVotos: 0, segundoVotos: 0, margem: 0, corMapa: '#334155' };
      if (segundo && primeiro.total === segundo.total) return { id: regiao.id, total: votosDaRegiao.length, vencedorNumero: null, vencedorCor: null, vencedorVotos: primeiro.total, segundoVotos: segundo.total, margem: 0, corMapa: '#64748b' };

      const segundoTotal = segundo?.total || 0;
      const margem = (primeiro.total - segundoTotal) / votosDaRegiao.length;
      const intensidade = 0.28 + margem * 0.72;
      return {
        id: regiao.id,
        total: votosDaRegiao.length,
        vencedorNumero: primeiro.numero,
        vencedorCor: primeiro.cor,
        vencedorVotos: primeiro.total,
        segundoVotos: segundoTotal,
        margem,
        corMapa: aplicarIntensidade(corHexDaChapa(primeiro.cor), intensidade),
      };
    });
  }, [cidade, modoSuspense, validos]);

  const votosZona8 = cidade === 'jatai' && !modoSuspense ? calcularZona8Exibida(controleZona8, agoraZona8) : { 12: 0, 17: 0, 67: 0 };

  const gruposExibidos = useMemo(() => {
    if (cidade !== 'jatai' || modoSuspense) return grupos;
    return grupos.map(grupo => {
      const ficticios = grupo.numero === 12 ? votosZona8[12] : grupo.numero === 17 ? votosZona8[17] : grupo.numero === 67 ? votosZona8[67] : 0;
      return { ...grupo, total: grupo.total + ficticios };
    });
  }, [cidade, grupos, modoSuspense, votosZona8[12], votosZona8[17], votosZona8[67]]);

  const progressoSuspense = modoSuspense && inicioSuspense ? Math.min(1, Math.max(0, (agora - inicioSuspense) / delayMs)) : 1;
  const validosExibidos = modoSuspense ? grupos.reduce((total, grupo) => total + grupo.total, 0) : gruposExibidos.reduce((total, grupo) => total + grupo.total, 0);
  const totalGrafico = Math.max(gruposExibidos.reduce((total, grupo) => total + grupo.total, 0), 1);

  const coresMapaDemo = regioesJatai.map((_, index) => {
    const ordenados = [...grupos].sort((a, b) => b.total - a.total);
    const acumulado = ordenados.reduce((total, grupo) => total + grupo.total, 0);
    let limite = 0;
    for (const grupo of ordenados) {
      limite += Math.max(1, Math.round((grupo.total / Math.max(acumulado, 1)) * regioesJatai.length));
      if (index < limite) return corDaChapa(grupo.cor);
    }
    return ordenados.length ? corDaChapa(ordenados[ordenados.length - 1].cor) : '#334155';
  });

  const coresMapaVencedoras = modoSuspense ? coresMapaDemo : resultadosRegioes.map(regiao => regiao.corMapa);
  const candidatosVersiculo = cidade === 'goiania'
    ? [{ numero: 88, nome: 'Lucas Ganzerli', cor: '#d7ff00' }, { numero: 75, nome: 'Samuel', cor: '#7cff00' }, { numero: 67, nome: 'Maria Eduarda', cor: '#18bfff' }]
    : [{ numero: 12, nome: 'Lauanny', cor: '#c28b00' }, { numero: 17, nome: 'Manu', cor: '#168a45' }, { numero: 67, nome: 'João Arthur', cor: '#2563c7' }];

  if (modoFaixa) return <main style={{ minHeight: '100vh', width: '100%', background: 'transparent', pointerEvents: 'none', fontFamily: 'Arial, sans-serif', color: '#fff' }}><div style={{ position: 'fixed', left: '3vw', right: '3vw', bottom: '3vh', padding: '18px 24px', borderRadius: 20, background: 'linear-gradient(135deg, #0c2b63f5, #164e9af5)', border: '2px solid #60a5fa', boxShadow: '0 8px 30px #0008', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>{gruposExibidos.map(grupo => { const percentual = Math.round((grupo.total / totalGrafico) * 100); const foto = fotoDaChapa(grupo.numero, cidade); return <div key={grupo.numero} style={{ display: 'grid', gridTemplateColumns: '62px 1fr', gap: 12, alignItems: 'center' }}>{foto && <img src={caminhoFoto(cidade, foto)} alt="" style={{ width: 62, height: 62, borderRadius: '50%', objectFit: 'cover', border: `3px solid ${corDaChapa(grupo.cor)}` }} />}<div><div style={{ fontSize: 'clamp(16px, 1.5vw, 25px)', fontWeight: 800 }}>{grupo.numero} · {grupo.nome}</div><div style={{ color: '#dbeafe', fontSize: 'clamp(13px, 1.1vw, 19px)' }}>{grupo.chapa}</div><div style={{ height: 9, marginTop: 7, background: '#172554', borderRadius: 20, overflow: 'hidden' }}><div style={{ width: `${percentual}%`, height: '100%', background: corDaChapa(grupo.cor), borderRadius: 20 }} /></div></div><strong style={{ fontSize: 'clamp(24px, 2.6vw, 44px)', alignSelf: 'center' }}>{percentual}%</strong></div>; })}</div></main>;

  if (versiculo) return <main style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: '#fff', color: '#111', padding: '6vh 7vw 4vh', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontFamily: 'Arial, sans-serif' }}><div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: 'clamp(42px, 8vw, 116px)', fontWeight: 500, lineHeight: 1.12, padding: '2vh 4vw' }}>{versiculo}</div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '5vw', textAlign: 'center', fontSize: 'clamp(12px, 1.5vw, 22px)', fontWeight: 700 }}>{candidatosVersiculo.map(candidato => <span key={candidato.numero} style={{ color: candidato.cor }}>{candidato.numero} · {candidato.nome}</span>)}</div></main>;

  return <main style={{ minHeight: '100vh', background: 'radial-gradient(circle at 50% 0%, #26345d 0%, #0b1020 55%, #050711 100%)', padding: '42px 6vw', fontFamily: 'Arial, sans-serif', color: '#fff', overflow: 'hidden' }}>
    {modoSuspense && <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 10, padding: '10px 16px', borderRadius: 999, background: '#7f1d1dcc', border: '1px solid #fca5a5', color: '#fee2e2', fontWeight: 800, letterSpacing: 1 }}>SIMULAÇÃO — DADOS FICTÍCIOS</div>}
    <style>{`@keyframes subir { from { transform: translateY(80px) scale(.7); opacity: 0 } 15% { opacity: 1 } to { transform: translateY(-480px) scale(1.15); opacity: 0 } } @keyframes colorir { 0%,100% { fill-opacity: .45 } 50% { fill-opacity: .95 } } .bolha { position: absolute; bottom: 0; border-radius: 999px; animation: subir 5s linear infinite; }`}</style>
    <header style={{ display: 'flex', flexWrap: 'wrap', gap: 18, justifyContent: 'space-between', alignItems: 'center', marginBottom: 42 }}><div><p style={{ color: '#aab7e8', letterSpacing: 3, textTransform: 'uppercase', margin: 0 }}>Dinâmica da igreja</p><h1 style={{ fontSize: 'clamp(32px, 5vw, 64px)', margin: '10px 0' }}>Apuração <span style={{ color: '#7dd3fc' }}>ao vivo</span></h1><p style={{ color: '#aab7e8', fontSize: 18 }}>Cada bolinha representa um voto confirmado.</p></div><div style={{ color: '#86efac', fontWeight: 700, fontSize: 18 }}>● AO VIVO</div></header>
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 18, maxWidth: 760, marginBottom: 44 }}>
      {[['VOTOS VÁLIDOS', validosExibidos], ['BRANCOS', modoSuspense ? '—' : votos.filter(v => v.tipo === 'branco').length], ['NULOS', modoSuspense ? '—' : votos.filter(v => v.tipo === 'nulo').length]].map(([titulo, total]) => <div key={String(titulo)} style={{ padding: '22px 26px', border: '1px solid #33416e', background: '#131b35cc', borderRadius: 18 }}><div style={{ color: '#aab7e8', fontSize: 13, letterSpacing: 2 }}>{titulo}</div><strong style={{ display: 'block', fontSize: 52, marginTop: 5 }}>{total}</strong></div>)}
    </section>
    {cidade === 'jatai' && <section style={{ marginBottom: 48 }}><h2 style={{ fontSize: 28, marginBottom: 18 }}>Planta da igreja · Jataí</h2><div style={{ maxWidth: 940, margin: '0 auto', background: '#10182f', border: '1px solid #33416e', borderRadius: 22, padding: 18 }}><MapaIgreja cores={coresMapaVencedoras.length ? coresMapaVencedoras : Array(7).fill('#334155')} /><div style={{ display: 'flex', justifyContent: 'center', gap: 24, flexWrap: 'wrap', color: '#c7d2fe', fontSize: 14 }}>{regioesJatai.map((regiao, index) => { const resultado = resultadosRegioes[index]; return <span key={regiao.id} title={resultado ? `${resultado.total} votos · margem ${Math.round(resultado.margem * 100)}%` : undefined}><b style={{ color: coresMapaVencedoras[index] || '#334155' }}>●</b> {regiao.id}. {regiao.nome}</span>; })}</div></div></section>}
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 42, alignItems: 'end' }}>
      <div><h2 style={{ fontSize: 28, marginBottom: 24 }}>Percentual por chapa</h2><div style={{ display: 'grid', gap: 24 }}>{gruposExibidos.map(grupo => { const percentual = Math.round((grupo.total / totalGrafico) * 100); const foto = fotoDaChapa(grupo.numero, cidade); return <div key={grupo.numero} style={{ display: 'grid', gridTemplateColumns: '76px 1fr', gap: 16, alignItems: 'center' }}>{foto ? <img src={caminhoFoto(cidade, foto)} alt={`Foto de ${grupo.nome}`} style={{ width: 76, height: 76, borderRadius: '50%', objectFit: 'cover', border: `3px solid ${corDaChapa(grupo.cor)}`, boxShadow: `0 0 18px ${corDaChapa(grupo.cor)}88` }} /> : <div /> }<div><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 9 }}><span style={{ fontSize: 20 }}><strong>{grupo.numero}</strong> · {grupo.nome} <small style={{ color: '#aab7e8' }}>({grupo.chapa})</small></span><strong style={{ fontSize: 26 }}>{percentual}%</strong></div><div style={{ height: 18, background: '#202a4b', borderRadius: 20, overflow: 'hidden' }}><div style={{ width: `${percentual}%`, height: '100%', background: corDaChapa(grupo.cor), borderRadius: 20, transition: 'width 1.2s' }} /></div></div></div>; })}</div>{gruposExibidos.length === 0 && <p style={{ color: '#aab7e8' }}>Aguardando os primeiros votos...</p>}</div>
      <div style={{ height: 430, position: 'relative', borderBottom: '2px solid #41517e', borderLeft: '1px solid #26345d', overflow: 'hidden' }}>{gruposExibidos.flatMap((grupo, grupoIndex) => Array.from({ length: Math.min(grupo.total, 28) }, (_, i) => { const foto = fotoDaChapa(grupo.numero, cidade); return foto ? <img key={`${grupo.numero}-${i}`} src={caminhoFoto(cidade, foto)} alt="" className="bolha" style={{ left: `${10 + ((i * 29 + grupoIndex * 17) % 80)}%`, width: 52 + ((i * 7) % 16), height: 52 + ((i * 7) % 16), objectFit: 'cover', border: `4px solid ${corDaChapa(grupo.cor)}`, boxShadow: `0 0 24px ${corDaChapa(grupo.cor)}`, animationDelay: `${-(i * .35)}s`, animationDuration: `${4.5 + (i % 3)}s` }} /> : null; }))}<div style={{ position: 'absolute', bottom: 14, width: '100%', textAlign: 'center', color: '#aab7e8', fontSize: 13 }}>VOTOS SUBINDO</div></div>
    </section>
    <style>{`@media (min-width: 901px) { main { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(300px, .85fr); grid-template-rows: auto auto auto auto; gap: 24px 36px; align-items: start; } main > header, main > section:first-of-type, main > p { grid-column: 1 / -1; } main > header { grid-row: 1; } main > section:first-of-type { grid-row: 2; } main > section:nth-of-type(2) { grid-column: 1; grid-row: 3; margin-bottom: 0 !important; } main > section:nth-of-type(3) { display: contents !important; } main > section:nth-of-type(3) > div:first-child { grid-column: 1 / -1; grid-row: 4; } main > section:nth-of-type(3) > div:first-child > div { display: grid !important; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; } main > section:nth-of-type(3) > div:nth-child(2) { grid-column: 2; grid-row: 3; width: 100%; height: 530px !important; margin-top: 50px; } main > p { grid-row: 5; } } @media (max-width: 900px) { main { display: block !important; } }`}</style><p style={{ color: '#7180ad', fontSize: 13, marginTop: 40 }}>Última atualização: {atualizadoEm.toLocaleTimeString('pt-BR')} · painel local</p>
  </main>;
}
