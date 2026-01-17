window.homePage = (() => {
  const NEWS_API_URL = "https://soundsense.pro/api/news.php";
  const PAGES_API_URL = "https://soundsense.pro/api/pages.php";
  const PAGE_SLUG = "home";

  const blockTemplates = {
    hero: (data) => `
      <section class="home-hero">
        <div class="home-hero__content">
          <span class="home-pill">${data.tag}</span>
          <h1>${data.title}</h1>
          <p>${data.subtitle}</p>
          <div class="home-hero__actions">
            <button class="hero-cta" data-load-page="${data.cta.page}">${data.cta.label}</button>
            <button class="ghost-cta" data-load-page="${data.secondary.page}">${data.secondary.label}</button>
          </div>
        </div>
        <div class="home-hero__panel">
          <div class="home-hero__glow"></div>
          <div class="home-hero__panel-inner">
            <h3>${data.panel.title}</h3>
            <p>${data.panel.text}</p>
            <span>${data.panel.note}</span>
          </div>
        </div>
      </section>
    `,
    featureGrid: (data) => `
      <section class="home-feature">
        <div class="section-header">
          <h2>${data.title}</h2>
          <p>${data.subtitle}</p>
        </div>
        <div class="home-feature__grid">
          ${data.items
            .map(
              (item) => `
              <article class="home-feature__card">
                <span class="home-feature__tag">${item.tag}</span>
                <h3>${item.title}</h3>
                <p>${item.text}</p>
                <button class="offer-cta ${item.ghost ? "ghost" : ""}" data-load-page="${item.page}">
                  ${item.cta}
                </button>
              </article>
            `
            )
            .join("")}
        </div>
      </section>
    `,
    stagepadInstructions: (data) => `
      <section class="stagepad-instructions">
        <div class="stagepad-instructions__video" role="img" aria-label="${data.mediaLabel}">
          <div class="stagepad-instructions__badge">${data.badge}</div>
          <div class="stagepad-instructions__play">▶</div>
          <div class="stagepad-instructions__caption">${data.mediaCaption}</div>
        </div>
        <div class="stagepad-instructions__text">
          <h2>${data.title}</h2>
          <p>${data.paragraphs[0]}</p>
          <p>${data.paragraphs[1]}</p>
          <div class="stagepad-instructions__steps">
            ${data.steps
              .map(
                (step) => `
                <div>
                  <h4>${step.title}</h4>
                  <p>${step.text}</p>
                </div>
              `
              )
              .join("")}
          </div>
        </div>
      </section>
    `,
    stagepadHero: (data) => `
      <section class="stagepad-hero">
        <div class="stagepad-media">
          <div class="stagepad-media__frame">
            <img src="${data.mediaSrc}" alt="${data.mediaAlt}" />
            <div class="stagepad-media__badge">${data.mediaBadge}</div>
          </div>
        </div>
        <div class="stagepad-info">
          <div class="stagepad-tag">${data.tag}</div>
          <h1>${data.title}</h1>
          <p class="stagepad-lead">${data.lead}</p>
          <div class="stagepad-features">
            <div>
              <h4>${data.featureLeft.title}</h4>
              <ul>
                ${data.featureLeft.items.map((item) => `<li>${item}</li>`).join("")}
              </ul>
            </div>
            <div>
              <h4>${data.featureRight.title}</h4>
              <ul>
                ${data.featureRight.items.map((item) => `<li>${item}</li>`).join("")}
              </ul>
            </div>
          </div>
          <div class="stagepad-cta">
            <button class="stagepad-cta__button" type="button" data-load-page="stagepad">
              ${data.ctaLabel}
            </button>
            <div class="stagepad-cta__note">${data.ctaNote}</div>
          </div>
        </div>
      </section>
    `,
    newsGrid: (data) => `
      <section class="home-news">
        <div class="section-header">
          <h2>${data.title}</h2>
          <p>${data.subtitle}</p>
        </div>
        <div class="home-news__grid">
          ${data.items
            .map(
              (item) => `
              <article class="home-news__card">
                <div class="home-news__meta">${item.date} · ${item.category}</div>
                <h3>${item.title}</h3>
                <p>${item.excerpt}</p>
                <button class="ghost-cta" data-load-page="${item.page}">${item.cta}</button>
              </article>
            `
            )
            .join("")}
        </div>
      </section>
    `,
    newsSpotlight: (data) => `
      <section class="home-news home-news--spotlight">
        <div class="section-header">
          <h2>${data.title}</h2>
          <p>${data.subtitle}</p>
        </div>
        <div class="home-news__spotlight">
          <article class="home-news__feature">
            <div class="home-news__meta">${data.feature.date} · ${data.feature.category}</div>
            <h3>${data.feature.title}</h3>
            <p>${data.feature.excerpt}</p>
            <button class="offer-cta ghost" data-load-page="${data.feature.page}">
              ${data.feature.cta}
            </button>
          </article>
          <div class="home-news__list">
            ${data.items
              .map(
                (item) => `
                <article class="home-news__row">
                  <div class="home-news__meta">${item.date} · ${item.category}</div>
                  <h4>${item.title}</h4>
                  <p>${item.excerpt}</p>
                </article>
              `
              )
              .join("")}
          </div>
        </div>
      </section>
    `,
    newsHero: (data) => `
      <section class="home-news home-news--hero">
        <div class="home-news__hero">
          <div class="home-news__hero-content">
            <div class="home-news__meta">${data.date} · ${data.category}</div>
            <h2>${data.title}</h2>
            <p>${data.excerpt}</p>
            <button class="offer-cta" data-load-page="${data.page}">${data.cta}</button>
          </div>
          <div class="home-news__hero-side">
            <div class="home-news__hero-tag">${data.tag}</div>
            <div class="home-news__hero-note">${data.note}</div>
          </div>
        </div>
      </section>
    `,
  };

  let pageBlocks = [
    {
      type: "hero",
      data: {
        tag: "SoundSense Launcher",
        title: "Запусти студийный контроль из одного окна",
        subtitle:
          "Собирай проекты, переключай режимы и управляй сценой без лишних переходов.",
        cta: { label: "Открыть тренировки", page: "games" },
        secondary: { label: "StagePad Remote", page: "stagepad" },
        panel: {
          title: "Новая программа",
          text: "Иммерсивный микс: живые стримы + домашние задания.",
          note: "Старт потока: 12 апреля",
        },
      },
    },
    {
      type: "featureGrid",
      data: {
        title: "Горячие подборки",
        subtitle: "Быстрые сценарии, которые запускают чаще всего.",
        items: [
          {
            tag: "Новинка",
            title: "Immersive Pack",
            text: "Три тренажера и единый рейтинг прогресса.",
            cta: "Запустить",
            page: "games",
          },
          {
            tag: "Соревнование",
            title: "Mix Arena",
            text: "Еженедельные челленджи и лидерборд.",
            cta: "Подробнее",
            page: "games",
            ghost: true,
          },
          {
            tag: "Коллекция",
            title: "NoteFlow Mastery",
            text: "45 уровней распознавания нот и гармоний.",
            cta: "Начать",
            page: "game_piano",
          },
        ],
      },
    },
    {
      type: "newsHero",
      data: {
        date: "14.03",
        category: "Главная новость",
        title: "Запуск SoundSense Remote для StagePad",
        excerpt:
          "Теперь можно управлять перфомансом с телефона: кнопки, микшер и список проектов доступны по QR.",
        cta: "Читать новость",
        page: "news",
        tag: "Важно",
        note: "Новые функции уже в релизе.",
        source: "news_api",
      },
    },
    {
      type: "newsSpotlight",
      data: {
        title: "Новости SoundSense",
        subtitle: "Главные обновления и релизы в одном месте.",
        feature: {
          date: "12.03",
          category: "Обновление",
          title: "StagePad получил быстрые пресеты",
          excerpt:
            "Добавили сохранение сцен и быстрый старт для новых перфомансов.",
          cta: "Читать",
          page: "news",
        },
        items: [
          {
            date: "07.03",
            category: "Remote",
            title: "Стабильное соединение через QR",
            excerpt: "Исправили автоподключение, сессии не обрываются.",
          },
          {
            date: "01.03",
            category: "Бета",
            title: "Лаунчер готов к модульным обновлениям",
            excerpt: "Подключили систему контентных блоков для страниц.",
          },
        ],
        source: "news_api",
      },
    },
    {
      type: "stagepadInstructions",
      data: {
        mediaLabel: "Видео-инструкция StagePad",
        badge: "Видео-инструкция",
        mediaCaption: "Короткий тур по StagePad (в подготовке)",
        title: "Как начать работу",
        paragraphs: [
          "Здесь будет подробная инструкция по запуску и первичной настройке StagePad. Внутри — обзор проекта, создание первой сцены, импорт треков и настройка микшера.",
          "Мы покажем, как быстро собрать сет выступления, настроить горячие клавиши и сохранить пресет для следующего запуска. Пока это тестовый блок, текст будет обновлен вместе с видео.",
        ],
        steps: [
          {
            title: "Шаг 1",
            text: "Выберите проект или создайте новый шаблон под ваше выступление.",
          },
          {
            title: "Шаг 2",
            text: "Добавьте аудио и сцены, отрегулируйте уровни и эффекты.",
          },
          {
            title: "Шаг 3",
            text: "Сохраните пресет, запустите перфоманс и переходите на сцену.",
          },
        ],
      },
    },
    {
      type: "stagepadHero",
      data: {
        mediaSrc: "pages/assets/stagepad-1.svg",
        mediaAlt: "StagePad preview",
        mediaBadge: "Фото",
        tag: "Сцена и медиа",
        title: "StagePad",
        lead:
          "StagePad помогает собирать интерактивные сцены, управлять треками, плейлистами и визуальными эффектами в одном месте.",
        featureLeft: {
          title: "Что внутри",
          items: [
            "Каталог проектов и шаблонов",
            "Микшер с гибкими группами",
            "Перфоманс-режим для выступлений",
          ],
        },
        featureRight: {
          title: "Для кого",
          items: [
            "Ведущие и ивент-команды",
            "Музыкальные школы и педагоги",
            "Сцены, клубы, студии",
          ],
        },
        ctaLabel: "Открыть StagePad",
        ctaNote: "Полная страница StagePad доступна в каталоге модулей.",
      },
    },
    {
      type: "newsGrid",
      data: {
        title: "Лента обновлений",
        subtitle: "Свежие релизы и новости команды.",
        items: [
          {
            date: "12.03",
            category: "Обновление",
            title: "StagePad получил быстрые пресеты",
            excerpt: "Добавили сохранение сцен и быстрый старт.",
            cta: "Читать",
            page: "news",
          },
          {
            date: "07.03",
            category: "Remote",
            title: "Стабильное соединение через QR",
            excerpt: "Исправили автоподключение и синхронизацию.",
            cta: "Читать",
            page: "news",
          },
          {
            date: "01.03",
            category: "Бета",
            title: "Модульные блоки для главной",
            excerpt: "Теперь контент можно обновлять без релиза.",
            cta: "Читать",
            page: "news",
          },
        ],
        source: "news_api",
      },
    },
  ];

  let lastPageUpdatedAt = null;
  let refreshTimer = null;

  const findBlock = (type) => pageBlocks.find((block) => block.type === type);
  const getBlockData = (block) => block?.data || block || {};

  function render(container) {
    const blocks = pageBlocks
      .map((block) => {
        const renderer = blockTemplates[block.type];
        return renderer ? renderer(getBlockData(block)) : "";
      })
      .join("");
    container.innerHTML = blocks;
  }

  async function fetchNewsList({ limit = 6, featured = false } = {}) {
    const res = await fetch(NEWS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "news_list",
        limit,
        featured,
        status: "published",
      }),
    });
    const payload = await res.json();
    if (payload?.status !== "success") {
      throw new Error(payload?.message || "News API error");
    }
    return Array.isArray(payload.items) ? payload.items : [];
  }

  function applyNewsData(items) {
    if (!items.length) return;
    const heroBlock = findBlock("newsHero");
    if (heroBlock) {
      const heroData = getBlockData(heroBlock);
      if (heroData.source !== "news_api") {
        return;
      }
      const featuredItem = items.find((item) => item.is_featured) || items[0];
      if (featuredItem) {
        heroData.date = formatDate(featuredItem.published_at);
        heroData.category = featuredItem.category || "Новости";
        heroData.title = featuredItem.title;
        heroData.excerpt = featuredItem.excerpt;
        heroData.page = `news/${featuredItem.slug}`;
      }
    }

    const spotlightBlock = findBlock("newsSpotlight");
    if (spotlightBlock) {
      const spotlightData = getBlockData(spotlightBlock);
      if (spotlightData.source !== "news_api") {
        return;
      }
      const [first, ...rest] = items;
      if (first) {
        spotlightData.feature = {
          date: formatDate(first.published_at),
          category: first.category || "Новости",
          title: first.title,
          excerpt: first.excerpt,
          cta: "Читать",
          page: `news/${first.slug}`,
        };
      }
      spotlightData.items = rest.slice(0, 2).map((item) => ({
        date: formatDate(item.published_at),
        category: item.category || "Новости",
        title: item.title,
        excerpt: item.excerpt,
      }));
    }

    const gridBlock = findBlock("newsGrid");
    if (gridBlock) {
      const gridData = getBlockData(gridBlock);
      if (gridData.source !== "news_api") {
        return;
      }
      gridData.items = items.slice(0, 3).map((item) => ({
        date: formatDate(item.published_at),
        category: item.category || "Новости",
        title: item.title,
        excerpt: item.excerpt,
        cta: "Читать",
        page: `news/${item.slug}`,
      }));
    }
  }

  function formatDate(value) {
    if (!value) return "--.--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--.--";
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${day}.${month}`;
  }

  async function fetchPageConfig() {
    const res = await fetch(PAGES_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "get_page",
        slug: PAGE_SLUG,
      }),
    });
    const payload = await res.json();
    if (payload?.status !== "success") {
      throw new Error(payload?.message || "Pages API error");
    }
    return payload;
  }

  function normalizeBlocks(blocks) {
    if (!Array.isArray(blocks)) return [];
    return blocks
      .filter((block) => block && block.type && blockTemplates[block.type])
      .map((block) => ({
        type: block.type,
        data: block.data && typeof block.data === "object" ? block.data : {},
      }));
  }

  function init() {
    const container = document.getElementById("home-page");
    if (!container) return;
    render(container);

    const refreshPage = async () => {
      try {
        const payload = await fetchPageConfig();
        const updatedAt = payload?.updated_at || payload?.page?.updated_at || null;
        const blocks = payload?.blocks || payload?.page?.blocks;
        const normalized = normalizeBlocks(blocks);
        if (normalized.length && updatedAt !== lastPageUpdatedAt) {
          pageBlocks = normalized;
          lastPageUpdatedAt = updatedAt;
          render(container);
        }
      } catch (_) {
        // Keep local fallback on error.
      }

      try {
        const items = await fetchNewsList({ limit: 6 });
        applyNewsData(items);
        render(container);
      } catch (_) {}
    };

    refreshPage();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshPage, 15000);
  }

  return { init, templates: blockTemplates };
})();
