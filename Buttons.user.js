// ==UserScript==
// @name         YouTube Spotify + Download Buttons (Auto-Collapse Fix)
// @namespace    http://tampermonkey.net/
// @version      5.2
// @description  Expands description to scrape metadata, then collapses it back.
// @author       akavi
// @match        https://www.youtube.com/watch*
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
    'use strict';

    const CHECK_INTERVAL_MS = 500;
    let lastKnownTitle = '';

    // --- Utils ---
    function getVideoIdFromUrl() {
        return new URLSearchParams(window.location.search).get('v');
    }

    function getChannelName() {
        const channelLink = document.querySelector('ytd-watch-metadata ytd-channel-name a');
        return channelLink ? channelLink.textContent.trim() : '';
    }

    // --- PRIORITY 1: Internal API Data (Cleanest) ---
    function getYtdAppData() {
        try {
            const ytdApp = document.querySelector('ytd-app');
            if (!ytdApp) return null;
            return (ytdApp.__data && ytdApp.__data.data) || ytdApp.data || null;
        } catch (e) {
            return null;
        }
    }

    function getSimpleText(defaultMetadata) {
        if (!defaultMetadata) return null;
        if (typeof defaultMetadata.simpleText === 'string') return defaultMetadata.simpleText;
        if (defaultMetadata.runs) {
            return defaultMetadata.runs.map(r => r.text).join('');
        }
        return null;
    }

    function getMusicMetadataFromAPI(pData) {
        if (!pData || !pData.response) return null;
        const panels = pData.response.engagementPanels || [];
        let carouselLockups = null;

        for (const ep of panels) {
            const items = ep.engagementPanelSectionListRenderer?.content?.structuredDescriptionContentRenderer?.items || [];
            for (const item of items) {
                if (item.videoDescriptionMusicSectionRenderer?.carouselLockups) {
                    carouselLockups = item.videoDescriptionMusicSectionRenderer.carouselLockups;
                    break;
                }
            }
            if (carouselLockups) break;
        }

        if (carouselLockups && carouselLockups.length === 1) {
            try {
                const row1 = carouselLockups[0].carouselLockupRenderer.infoRows[0].infoRowRenderer.defaultMetadata;
                const row2 = carouselLockups[0].carouselLockupRenderer.infoRows[1].infoRowRenderer.defaultMetadata;
                const songTitle = getSimpleText(row1);
                const artistName = getSimpleText(row2);
                if (songTitle && artistName) {
                    return { song: songTitle.trim(), artist: artistName.replace(/\s+/g, ' ').trim() };
                }
            } catch (e) { }
        }
        return null;
    }

    // --- PRIORITY 2: DOM Scrape with Auto-Collapse ---
    function scrapeMusicFromDOM() {
        let expandedByScript = false;
        let foundMeta = null;

        // 1. Force Expand Description if it is currently collapsed
        const expandBtn = document.querySelector('tp-yt-paper-button#expand');
        // offsetParent !== null checks if the button is visible (i.e., description is collapsed)
        if (expandBtn && expandBtn.offsetParent !== null) {
            expandBtn.click();
            expandedByScript = true;
        }

        // 2. Look for the Music Card (yt-video-attribute-view-model)
        const musicRows = document.querySelectorAll('yt-video-attribute-view-model');

        for (const row of musicRows) {
            const titleEl = row.querySelector('h1');
            const subtitleEl = row.querySelector('h4');

            if (titleEl && subtitleEl) {
                const song = titleEl.textContent.trim();
                const artist = subtitleEl.textContent.trim();

                if (song && artist) {
                    console.log('[Tampermonkey] Scraped DOM Metadata:', { artist, song });
                    foundMeta = { artist, song };
                    break;
                }
            }
        }

        // 3. Cleanup: Press "Show less" only if WE opened it
        if (expandedByScript) {
            const collapseBtn = document.querySelector('tp-yt-paper-button#collapse');
            if (collapseBtn) {
                collapseBtn.click();
            }
        }

        return foundMeta;
    }

    // --- PRIORITY 3: Regex Fallbacks (Cleaners) ---
    function cleanTitle(title) {
        return title
            .replace(/\(\s*OFFICIAL\s*VIDEO\s*\)/gi, '')
            .replace(/\(\s*OFFICIAL\s+MUSIC\s+VIDEO\s*\)/gi, '')
            .replace(/\(\s*(?:HD|HQ|4K)\s*\)/gi, '')
            .replace(/[\u{1F300}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
            .replace(/[–—−]/g, '-')
            .replace(/【([^【】]+)】/g, '[$1]')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    // --- MASTER PARSER ---
    function parseTitleAndArtist(rawTitle) {
        // 1. Try API Data
        const pData = getYtdAppData();
        const apiMeta = getMusicMetadataFromAPI(pData);
        if (apiMeta) return apiMeta;

        // 2. Try DOM Scrape (Expands & Collapses description)
        const domMeta = scrapeMusicFromDOM();
        if (domMeta) return domMeta;

        // 3. Regex Fallback
        let cleaned = cleanTitle(rawTitle);

        // JP Logic: "Artist「Song」"
        const matchJP = cleaned.match(/(?:.*[\/│]\s*)?(.+?)\s*[「『](.+?)[」』]/);
        if (matchJP) return { artist: matchJP[1].trim(), song: matchJP[2].trim() };

        // Standard: "Artist - Song"
        if (cleaned.includes(' - ')) {
            const [a, s] = cleaned.split(' - ', 2);
            return { artist: a.trim(), song: s.trim() };
        }

        // Quotes: Artist "Song"
        const mQ = cleaned.match(/^(.+?)\s*["“”‘’'`´]+(.+?)["“”‘’'`´]+/);
        if (mQ) return { artist: mQ[1].trim(), song: mQ[2].trim() };

        // Brackets: [Artist] Song
        const mB = cleaned.match(/^\[([^\]]+)\]\s*(.+)$/);
        if (mB) return { artist: mB[1].trim(), song: mB[2].trim() };

        // Fallback
        return { artist: getChannelName(), song: cleaned };
    }

    // --- UI Creation ---
    function createButton(label, color, onClick) {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.className = 'akavi-dl-btn';
        btn.style.cssText = `margin-left:10px;padding:5px 12px;font-size:14px;border:none;border-radius:18px;cursor:pointer;background:${color};color:white;font-weight:500;font-family:Roboto,Arial,sans-serif;vertical-align:middle;display:inline-block;`;
        btn.onclick = (e) => { e.stopPropagation(); onClick(btn); };
        return btn;
    }

    // --- Main Injection Logic ---
    function injectButtons(titleContainer) {
        if (titleContainer.querySelector('.akavi-dl-btn')) return;

        const textNode = titleContainer.querySelector('yt-formatted-string') || titleContainer;
        const currentTitle = textNode.textContent.trim();
        if (!currentTitle) return;

        // Spotify Button
        const spotifyBtn = createButton('🎧 Spotify', '#1DB954', () => {
            const { artist, song } = parseTitleAndArtist(currentTitle);
            const searchCtx = artist ? `${artist} ${song}` : song;
            console.log(`[Tampermonkey] Searching Spotify for: ${searchCtx}`);
            window.open(`https://open.spotify.com/search/${encodeURIComponent(searchCtx)}`, '_blank');
        });

        // Video DL
        const ytDlpBtn = createButton('Video DL', '#FF4C4C', (btn) => {
            const vUrl = `https://www.youtube.com/watch?v=${getVideoIdFromUrl()}`;
            const cmd = `yt-dlp -f "bv*+ba/best" --embed-metadata --embed-thumbnail --no-playlist --write-subs --sub-lang en,ja --embed-subs -o "$HOME/Downloads/%(title)s.%(ext)s" "${vUrl}"`;
            GM_setClipboard(cmd, 'text');
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = 'Video DL', 2000);
        });

        // Audio DL
        const audioBtn = createButton('Audio DL', '#FCA311', (btn) => {
            const vUrl = `https://www.youtube.com/watch?v=${getVideoIdFromUrl()}`;
            const cmd = `yt-dlp -f bestaudio --extract-audio --audio-format mp3 --audio-quality 0 -o "$HOME/Downloads/%(title)s.%(ext)s" "${vUrl}"`;
            GM_setClipboard(cmd, 'text');
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = 'Audio DL', 2000);
        });

        titleContainer.appendChild(spotifyBtn);
        titleContainer.appendChild(ytDlpBtn);
        titleContainer.appendChild(audioBtn);
    }

    // --- Loop ---
    setInterval(() => {
        if (!window.location.href.includes('/watch')) return;
        const titleH1 = document.querySelector('ytd-watch-metadata #title > h1') || document.querySelector('#title > h1.ytd-watch-metadata');
        if (!titleH1) return;

        const currentTitle = titleH1.textContent.trim();
        if (currentTitle && currentTitle !== lastKnownTitle) {
            lastKnownTitle = currentTitle;
            titleH1.querySelectorAll('.akavi-dl-btn').forEach(b => b.remove());
        }

        if (!titleH1.querySelector('.akavi-dl-btn')) injectButtons(titleH1);
    }, CHECK_INTERVAL_MS);

    console.log('[Tampermonkey] Auto-Collapse Script Loaded');
})();
