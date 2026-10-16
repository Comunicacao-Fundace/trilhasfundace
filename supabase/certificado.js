// Geração do certificado em PDF — compartilhada pelo player legado
// (Index.html) e pelo hub (hub.html). Layout idêntico ao do player, com uma
// linha extra de código de validação quando o certificado foi registrado no
// banco (RPC emitir_certificado).
// Depende de: supabase/certificate-template.js e pdf-lib (window.PDFLib).
(function () {
  function wrapCertificateText(text, maxChars) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";

    words.forEach(word => {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxChars) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    });

    if (current) lines.push(current);
    return lines;
  }

  // Quebra texto por largura real (em pontos), não por contagem de
  // caracteres — usado na lista de aulas do certificado pra aproveitar
  // melhor a largura disponível da página.
  function wrapCertificateTextByWidth(text, maxWidthPt, font, size) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";

    words.forEach(word => {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidthPt) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    });

    if (current) lines.push(current);
    return lines;
  }

  const CERTIFICATE_SMALL_WORDS = new Set([
    "de", "da", "do", "das", "dos", "e", "em", "na", "no", "nas", "nos",
    "a", "o", "as", "os", "para", "com", "ou", "um", "uma", "à", "ao", "aos"
  ]);

  // Title case com regras leves de português (preposições/artigos minúsculos,
  // exceto na primeira palavra; preserva siglas curtas como "IA").
  function toCertificateTitleCase(text) {
    return text.split(" ").map((word, i) => {
      if (!word) return word;
      const lower = word.toLowerCase();
      if (i > 0 && CERTIFICATE_SMALL_WORDS.has(lower)) return lower;
      if (word === word.toUpperCase() && word.length <= 4 && /[A-ZÀ-Ý]/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(" ");
  }

  // Desenha um "✓" vetorial — fontes padrão do pdf-lib (WinAnsi) não
  // conseguem codificar o caractere Unicode de checkmark.
  function drawCertificateCheckmark(page, x, y, size, color) {
    const thickness = Math.max(0.6, size * 0.14);
    page.drawLine({
      start: { x, y: y + size * 0.28 },
      end: { x: x + size * 0.32, y },
      thickness,
      color
    });
    page.drawLine({
      start: { x: x + size * 0.32, y },
      end: { x: x + size * 0.86, y: y + size * 0.62 },
      thickness,
      color
    });
  }

  function completedThemes(lessons, completedIds) {
    const done = new Set(completedIds || []);
    return [...new Set(
      lessons
        .filter(lesson => done.has(lesson.id))
        .map(lesson => lesson.title.split(" — ")[0].trim())
    )];
  }

  // Monta o PDF e devolve os bytes.
  // opts: { nome, curso: { id, title, certificateSlug }, lessons, completedIds,
  //         codigo?, validacaoUrl?, emitidoEm? }
  async function montar(opts) {
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const base64 = window.CERTIFICATE_TEMPLATE_BASE64;
    if (!base64) {
      throw new Error("Template do certificado não encontrado.");
    }

    const curso = opts.curso || {};
    const lessons = opts.lessons || [];

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const pdfDoc = await PDFDocument.load(bytes);
    const page = pdfDoc.getPages()[0];
    const width = page.getWidth();
    const height = page.getHeight();
    const fontBold   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const font       = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    const name     = String(opts.nome || "Aluno").trim();
    const nameSize = width > height ? 24 : 19;
    const bodySize = width > height ? 9  : 7.5;
    const lineGap  = width > height ? 13 : 10;
    const ink      = rgb(0.15, 0.15, 0.15);
    const inkSoft  = rgb(0.22, 0.22, 0.22);

    const drawCentered = (text, y, sz, fnt, color) => {
      const tw = fnt.widthOfTextAtSize(text, sz);
      page.drawText(text, { x: (width - tw) / 2, y, size: sz, font: fnt, color });
    };

    // Sobe o bloco inteiro de texto (não dá pra mexer no "CERTIFICADO" nem
    // na assinatura/logo, que são fixos no template) pra equilibrar a
    // margem entre o título e a assinatura no rodapé.
    const contentShiftY = height * 0.06;

    // "A FUNDACE certifica que"
    drawCentered("A FUNDACE certifica que", height * 0.65 + contentShiftY, bodySize, font, inkSoft);

    // Nome da pessoa
    drawCentered(name, height * 0.575 + contentShiftY, nameSize, fontBold, ink);

    // "cumpriu a grade do curso"
    drawCentered("cumpriu a grade do curso", height * 0.51 + contentShiftY, bodySize, fontItalic, inkSoft);

    // Nome da trilha
    const courseTitle = curso.title || "";
    if (courseTitle) {
      drawCentered(courseTitle, height * 0.47 + contentShiftY, width > height ? 13 : 10, fontBold, ink);
    }

    // Lista de aulas ou temas concluídos
    let contentLastLineY = height * 0.42 + contentShiftY;
    const isDynamicTrail = curso.id !== "ifrs" && curso.id !== "gestao";
    if (isDynamicTrail && lessons.length > 0) {
      const lessonListSize = width > height ? 7.5 : 6;
      const cleanTitle = t => t
        .replace(/^Aula\s+\d+\s*[:\-–]\s*/i, "")
        .replace(/^(?:[A-ZÀ-Ý][\wà-ÿ.]*\s+){1,5}[A-ZÀ-Ý][\wà-ÿ.]*\s-\s/, "") // remove prefixo "Nome do professor - "
        .replace(/\s*[-–]\s*Parte\s+\d+\s*$/i, "")
        .trim();
      const uniqueTopics = [...new Set(lessons.map(l => cleanTitle(l.title)))].map(toCertificateTitleCase);

      // "Programa cursado:" como cabeçalho, e cada aula vira uma linha com
      // um checkmark — em vez do parágrafo corrido de antes.
      const headingY = height * 0.42 + contentShiftY;
      drawCentered("Programa cursado:", headingY, bodySize, fontItalic, inkSoft);

      const bulletIndent = lessonListSize * 1.5;
      const maxTextWidthPt = width * 0.62;
      const bulletLines = [];
      uniqueTopics.forEach(topic => {
        wrapCertificateTextByWidth(topic, maxTextWidthPt, font, lessonListSize)
          .forEach((line, idx) => bulletLines.push({ text: line, isFirst: idx === 0 }));
      });

      const blockWidth = bulletIndent + Math.max(...bulletLines.map(l => font.widthOfTextAtSize(l.text, lessonListSize)));
      const blockLeftX = (width - blockWidth) / 2;
      const lessonStartY = headingY - lineGap * 1.4;
      bulletLines.forEach((line, i) => {
        const y = lessonStartY - (i * lineGap);
        if (line.isFirst) drawCertificateCheckmark(page, blockLeftX, y, lessonListSize, ink);
        page.drawText(line.text, { x: blockLeftX + bulletIndent, y, size: lessonListSize, font, color: inkSoft });
      });
      contentLastLineY = lessonStartY - ((bulletLines.length - 1) * lineGap);
    } else {
      const themes      = completedThemes(lessons, opts.completedIds);
      const themesLabel = themes.length ? themes.join(" • ") : "Trilha completa";
      const topicsSize  = width > height ? 7 : 5.5;
      const topicLines  = wrapCertificateText(themesLabel, width > height ? 58 : 38).slice(0, 2);
      const topicsStartY = height * 0.42 + contentShiftY;
      topicLines.forEach((line, i) => {
        const lw = font.widthOfTextAtSize(line, topicsSize);
        page.drawText(line, { x: (width - lw) / 2, y: topicsStartY - (i * lineGap), size: topicsSize, font, color: inkSoft });
      });
      contentLastLineY = topicsStartY - ((topicLines.length - 1) * lineGap);
    }

    // Data de emissão — respeita um espaçamento mínimo abaixo da última
    // linha do conteúdo cursado, empurrando a data pra baixo quando a
    // lista de aulas é longa (senão a data ficava colada/sobreposta).
    // Com certificado registrado, a data é a da primeira emissão (estável).
    const dataBase = opts.emitidoEm ? new Date(opts.emitidoEm) : new Date();
    const dateStr = dataBase.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const minGapAfterContent = lineGap * 2;
    const dateY = Math.min(height * 0.335 + contentShiftY, contentLastLineY - minGapAfterContent);
    drawCentered(dateStr, dateY, bodySize, font, inkSoft);

    if (opts.codigo) {
      const codeSize = width > height ? 6.5 : 5.5;
      const destino = opts.validacaoUrl ? ` em ${opts.validacaoUrl}` : "";
      drawCentered(`Código de validação: ${opts.codigo} · valide${destino}`, dateY - lineGap * 1.1, codeSize, font, inkSoft);
    }

    return { bytes: await pdfDoc.save(), name };
  }

  async function baixar(opts) {
    const { bytes, name } = await montar(opts);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeName = name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    link.href = url;
    const courseSlug = (opts.curso && opts.curso.certificateSlug) || "fundace";
    link.download = `certificado-${courseSlug}-${safeName || "aluno"}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  }

  window.FundaceCertificado = { montar, baixar };
})();
