// Catálogo das trilhas com aulas fixas (não vêm da tabela public.trilhas).
// Fonte única para o player legado (Index.html) e para o hub (hub.html).
// Os IDs de aula daqui são os mesmos gravados em public.user_lesson_progress:
// NÃO renomeie IDs existentes, senão o progresso histórico dos alunos se perde.
// Ao incluir/remover aulas, atualize também public.trilha_aulas_estaticas
// (supabase/hub_cadastro_universal.sql) para o certificado continuar validando.
window.FUNDACE_TRILHAS_ESTATICAS = {
      ifrs: {
        id: "ifrs",
        title: "Trilha Contabilidade em IFRS",
        subtitle: "Contabilidade, tributação e normas internacionais na prática.",
        description: "Conteúdos extraídos das aulas do MBA USP Contabilidade em IFRS. Assista na ordem, avance no seu ritmo e compreenda como as informações contábeis e fiscais impactam a gestão e a tomada de decisão.",
        pill: "4 temas · 8 aulas",
        ctaUrl: "https://www.fundace.org.br/lp/mba-ead-usp-contabilidade-em-ifrs",
        ctaEyebrow: "Trilha em Contabilidade em IFRS · Fundace / FEA-RP · USP",
        ctaTitle: "Quer aprofundar com método e sair com certificado?",
        ctaBody: "Acesse o MBA USP Contabilidade em IFRS completo: conteúdo avançado, corpo docente da FEA-RP/USP e certificado emitido pela Fundace.",
        certificateSlug: "ifrs",
        lessons: [
      {
        id: "lesson-1",
        title: "Contabilidade para Pequenas e Médias Empresas — Parte 1",
        duration: "Parte 1",
        level: "PME · Fundamentos",
        teacher: "Corpo docente Fundace",
        videoUrl: "https://vimeo.com/1016215682/aec8db18aa",
        eyebrow: "Aula 1 · liberada",
        highlights: [
          "Fundamentos da contabilidade aplicados às pequenas e médias empresas.",
          "Normas simplificadas (IFRS para PMEs): o que muda na prática.",
          "Reconhecimento e mensuração de ativos, passivos, receitas e despesas."
        ]
      },
      {
        id: "lesson-2",
        title: "Contabilidade para Pequenas e Médias Empresas — Parte 2",
        duration: "Parte 2",
        level: "PME · Aprofundamento",
        teacher: "Corpo docente Fundace",
        videoUrl: "https://vimeo.com/1126227055/0764827570",
        eyebrow: "Aula 2 · disponível após a Parte 1",
        highlights: [
          "Elaboração e interpretação das demonstrações financeiras para PMEs.",
          "Como usar a informação contábil como base para a tomada de decisão.",
          "Aplicação prática das normas no contexto de empresas de menor porte."
        ]
      },
      {
        id: "lesson-3",
        title: "Tributação Brasileira sobre o Lucro — Parte 1",
        duration: "Parte 1",
        level: "Tributação · Fundamentos",
        teacher: "Corpo docente Fundace",
        videoUrl: "https://vimeo.com/1091222787/833ec6dd79",
        eyebrow: "Aula 3",
        highlights: [
          "Apuração de tributos sobre o lucro: IRPJ e CSLL na prática.",
          "Regimes tributários: Lucro Real, Lucro Presumido e Lucro Arbitrado.",
          "Como calcular o lucro tributável e seus impactos financeiros e gerenciais."
        ]
      },
      {
        id: "lesson-4",
        title: "Tributação Brasileira sobre o Lucro — Parte 2",
        duration: "Parte 2",
        level: "Tributação · Aplicação",
        teacher: "Corpo docente Fundace",
        videoUrl: "https://vimeo.com/1093192101/03404e2b2e",
        eyebrow: "Aula 4",
        highlights: [
          "Planejamento tributário: como estruturar decisões fiscais com segurança.",
          "Diferenças temporárias e permanentes entre resultado contábil e fiscal.",
          "Reflexos dos tributos nas demonstrações e nos relatórios gerenciais."
        ]
      },
      {
        id: "lesson-5",
        title: "Instrumentos Financeiros Derivativos — Parte 1",
        duration: "Parte 1",
        level: "Derivativos · Fundamentos",
        teacher: "Especialistas do MBA",
        videoUrl: "https://vimeo.com/1100721384/3c020b9e98",
        eyebrow: "Aula 5",
        highlights: [
          "Conceitos essenciais: swaps, opções e futuros no contexto empresarial.",
          "Hedge: como usar derivativos para proteger a empresa contra riscos.",
          "Reconhecimento inicial e subsequente conforme normas internacionais."
        ]
      },
      {
        id: "lesson-6",
        title: "Instrumentos Financeiros Derivativos — Parte 2",
        duration: "Parte 2",
        level: "Derivativos · Aplicação",
        teacher: "Especialistas do MBA",
        videoUrl: "https://vimeo.com/1103111785/a9ba50b22e",
        eyebrow: "Aula 6",
        highlights: [
          "Mensuração a valor justo e impacto dos derivativos no resultado.",
          "Contabilização conforme normas internacionais: o que exige atenção.",
          "Como ler derivativos nas demonstrações financeiras e notas explicativas."
        ]
      },
      {
        id: "lesson-7",
        title: "Receitas de Contratos de Clientes — Parte 1",
        duration: "Parte 1",
        level: "IFRS 15 · Fundamentos",
        teacher: "Corpo docente Fundace",
        videoUrl: "https://vimeo.com/1142568306/2bc508dcdb",
        eyebrow: "Aula 7",
        highlights: [
          "IFRS 15 e CPC 47: o modelo de cinco passos para reconhecimento de receita.",
          "Como identificar contratos e obrigações de desempenho na prática.",
          "Impactos do novo modelo em empresas com contratos de longo prazo."
        ]
      },
      {
        id: "lesson-8",
        title: "Receitas de Contratos de Clientes — Parte 2",
        duration: "Parte 2",
        level: "IFRS 15 · Aplicação",
        teacher: "Corpo docente Fundace",
        videoUrl: "https://vimeo.com/1145040303/fe677c124a",
        eyebrow: "Aula 8 · Encerramento da trilha",
        highlights: [
          "Mensuração e alocação do preço de transação entre obrigações de desempenho.",
          "Receita ao longo do tempo versus em um ponto no tempo: critérios práticos.",
          "Divulgações exigidas pelo IFRS 15 e como interpretá-las nas demonstrações."
        ]
      }
        ]
      },
      gestao: {
        id: "gestao",
        title: "Trilha de Gestão de Produção com IA",
        subtitle: "Empreendedorismo, S&OP e Big Data aplicados à operação.",
        description: "Desenvolva visão estratégica, aprenda a integrar operação e demanda, e descubra como dados e IA impactam resultados reais na indústria.",
        pill: "3 temas · 6 aulas",
        ctaUrl: null,
        certificateSlug: "gestao",
        lessons: [
          {
            id: "gestao-1",
            title: "Empreendedorismo e Liderança — Parte 1",
            duration: "Parte 1",
            level: "Empreendedorismo · Fundamentos",
            teacher: "Lara Liboni",
            videoUrl: "https://vimeo.com/982059141/f275d8b2b5",
            eyebrow: "Aula 1 · liberada",
            highlights: [
              "Competências empreendedoras e liderança.",
              "Avaliação de oportunidades de negócio.",
              "Ferramentas como Canvas e Design Thinking.",
              "Como estruturar ideias e transformar em plano."
            ]
          },
          {
            id: "gestao-2",
            title: "Empreendedorismo e Liderança — Parte 2",
            duration: "Parte 2",
            level: "Empreendedorismo · Aprofundamento",
            teacher: "Lara Liboni",
            videoUrl: "https://vimeo.com/984477844/1ac99b599e",
            eyebrow: "Aula 2 · disponível após a Parte 1",
            highlights: [
              "Competências empreendedoras e liderança.",
              "Avaliação de oportunidades de negócio.",
              "Ferramentas como Canvas e Design Thinking.",
              "Como estruturar ideias e transformar em plano."
            ]
          },
          {
            id: "gestao-3",
            title: "S&OP Compras — Parte 1",
            duration: "Parte 1",
            level: "S&OP · Fundamentos",
            teacher: "Paulo Tavares",
            videoUrl: "https://vimeo.com/1144537980/3f2b0b92f0",
            eyebrow: "Aula 3",
            highlights: [
              "Planejamento de operações e vendas.",
              "Gestão da demanda.",
              "Compras estratégicas.",
              "Relacionamento e risco com fornecedores."
            ]
          },
          {
            id: "gestao-4",
            title: "S&OP Compras — Parte 2",
            duration: "Parte 2",
            level: "S&OP · Aplicação",
            teacher: "Paulo Tavares",
            videoUrl: "https://vimeo.com/1146621233/34dd3b3332",
            eyebrow: "Aula 4",
            highlights: [
              "Planejamento de operações e vendas.",
              "Gestão da demanda.",
              "Compras estratégicas.",
              "Relacionamento e risco com fornecedores."
            ]
          },
          {
            id: "gestao-5",
            title: "Big Data e IA em Operações — Parte 1",
            duration: "Parte 1",
            level: "Big Data · Fundamentos",
            teacher: "Eduardo Mendes",
            videoUrl: "https://vimeo.com/1066619263/00b268b059",
            eyebrow: "Aula 5",
            highlights: [
              "Big Data na indústria 4.0.",
              "Redução de custos e aumento de eficiência.",
              "Fundamentos de Inteligência Artificial.",
              "Machine Learning aplicado à operação."
            ]
          },
          {
            id: "gestao-6",
            title: "Big Data e IA em Operações — Parte 2",
            duration: "Parte 2",
            level: "Big Data · Aplicação",
            teacher: "Eduardo Mendes",
            videoUrl: "https://vimeo.com/1068919922/5fd633faad",
            eyebrow: "Aula 6 · Encerramento da trilha",
            highlights: [
              "Big Data na indústria 4.0.",
              "Redução de custos e aumento de eficiência.",
              "Fundamentos de Inteligência Artificial.",
              "Machine Learning aplicado à operação."
            ]
          }
        ]
      },
      "gestao-projetos": {
        id: "gestao-projetos",
        title: "Trilha de Gestão de Projetos",
        subtitle: "A gestão de projetos evoluiu. Você está acompanhando essa transformação?",
        description: "Descubra como Inteligência Artificial, Design Thinking e gestão de processos estão transformando a maneira de conduzir projetos e prepare-se para os desafios da nova era.",
        pill: "3 aulas",
        ctaUrl: null,
        certificateSlug: "gestao-projetos",
        lessons: [
          {
            id: "gestao-projetos-1",
            title: "Gestão de Projetos na Era da IA",
            duration: "Aula 1",
            level: "Cenário atual e caminhos possíveis",
            teacher: "A confirmar",
            videoUrl: "https://vimeo.com/1113659396/010bc6947d",
            eyebrow: "Aula 1 · liberada",
            highlights: [
              "Como a IA está transformando a gestão de projetos.",
              "Tendências e desafios para os próximos anos.",
              "Como utilizar a IA de forma estratégica na gestão."
            ]
          },
          {
            id: "gestao-projetos-2",
            title: "Criar e entregar",
            duration: "Aula 2",
            level: "A ponte entre Design Thinking e Gestão de Projetos",
            teacher: "A confirmar",
            videoUrl: "https://vimeo.com/1116191465/daae202809",
            eyebrow: "Aula 2",
            highlights: [
              "Como transformar necessidades reais em soluções de valor.",
              "Integração entre criatividade, inovação e execução.",
              "Estratégias para desenvolver projetos mais eficientes."
            ]
          },
          {
            id: "gestao-projetos-3",
            title: "Projetos e Processos",
            duration: "Aula 3",
            level: "Competências para liderar a nova era",
            teacher: "A confirmar",
            videoUrl: "https://www.youtube.com/watch?v=SPd31bn-QYc",
            eyebrow: "Aula 3 · Encerramento da trilha",
            highlights: [
              "Competências mais valorizadas no gestor atual.",
              "Como conectar processos, inovação e tecnologia.",
              "Caminhos para uma atuação mais estratégica."
            ]
          }
        ]
      },
      "gestao-estrategica-ti": {
        id: "gestao-estrategica-ti",
        title: "Trilha Pocket Gestão Estratégica de TI",
        subtitle: "Trilha Pocket Gestão Estratégica de TI",
        description: "Entenda como a Gestão de TI e a Transformação Digital estão ampliando o papel dos profissionais de tecnologia nas organizações. Duas Pocket Classes gratuitas com Prof. Ildeberto Rodello.",
        pill: "2 aulas",
        ctaUrl: null,
        allowSelfEnroll: true,
        certificateSlug: "gestao-estrategica-ti",
        lessons: [
          {
            id: "gestao-estrategica-ti-1",
            title: "O que é Gestão de TI e por que ela é estratégica?",
            duration: "Aproximadamente 15 min",
            level: "Gestão Estratégica de TI",
            teacher: "Prof. Ildeberto Rodello",
            videoUrl: "https://youtu.be/Yu-zeB2NvUE",
            eyebrow: "Aula 1 · liberada",
            highlights: [
              "A evolução do papel da TI nas organizações.",
              "A diferença entre operação e gestão de TI.",
              "O alinhamento entre tecnologia e objetivos do negócio.",
              "Infraestrutura, dados, pessoas, processos, finanças e riscos.",
              "As novas responsabilidades do gestor de TI."
            ]
          },
          {
            id: "gestao-estrategica-ti-2",
            title: "Transformação Digital: muito além da tecnologia",
            duration: "Aproximadamente 15 min",
            level: "Gestão Estratégica de TI",
            teacher: "Prof. Ildeberto Rodello",
            videoUrl: "https://youtu.be/UonIrUBZmMM",
            eyebrow: "Aula 2 · Encerramento da trilha",
            highlights: [
              "A diferença entre digitalização, digitização e Transformação Digital.",
              "Os quatro pilares do sucesso digital: pessoas, processos, tecnologia e dados.",
              "A evolução da TI tradicional para a TI estratégica.",
              "Os principais desafios da transformação nas organizações.",
              "A importância de conectar TI e objetivos de negócio."
            ]
          }
        ]
      },
      financas: {
        id: "financas",
        title: "Trilha de Finanças",
        subtitle: "Análise de investimentos, indicadores financeiros e gestão de risco.",
        description: "Aprenda a avaliar investimentos, interpretar indicadores e tomar decisões financeiras com mais segurança e método.",
        pill: "3 aulas",
        ctaUrl: "https://www.fundace.org.br/curso/mba-usp-ead-em-financas",
        ctaEyebrow: "Trilha de Finanças · Fundace / FEA-RP · USP",
        ctaTitle: "Quer aprofundar com método e sair com certificado?",
        ctaBody: "Acesse o MBA USP em Finanças completo: conteúdo avançado, corpo docente da FEA-RP/USP e certificado emitido pela USP.",
        certificateSlug: "financas",
        lessons: [
          {
            id: "financas-1",
            title: "Matemática Financeira — VPL x TIR",
            duration: "Aula 1",
            level: "Finanças · Fundamentos",
            teacher: "Eduardo Mendes",
            videoUrl: "https://www.youtube.com/watch?v=s3yZvIX7004",
            eyebrow: "Aula 1 · liberada",
            highlights: [
              "Avalie investimentos com base em VPL e TIR.",
              "Entenda quando cada indicador deve ser usado.",
              "Tome decisões de investimento com critérios objetivos."
            ]
          },
          {
            id: "financas-2",
            title: "Análise de Indicadores Financeiros",
            duration: "Aula 2",
            level: "Finanças · Indicadores",
            teacher: "Vinícius Magnani",
            videoUrl: "https://youtu.be/umEW9ss9lkY",
            eyebrow: "Aula 2",
            highlights: [
              "Interprete os principais indicadores financeiros.",
              "Transforme números em decisões estratégicas.",
              "Analise a saúde financeira de uma empresa."
            ]
          },
          {
            id: "financas-3",
            title: "Risco e Retorno de Ativos",
            duration: "Aula 3",
            level: "Finanças · Risco",
            teacher: "Vinícius Magnani",
            videoUrl: "https://youtu.be/akzU40-B7xQ",
            eyebrow: "Aula 3 · Encerramento da trilha",
            highlights: [
              "Equilibre risco e retorno nas decisões de investimento.",
              "Aplique fundamentos de finanças no contexto real.",
              "Conclua a trilha com visão financeira mais estratégica."
            ]
          }
        ]
      }
};
