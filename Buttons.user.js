// ==UserScript==
// @name         YouTube Spotify + Download Buttons
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Adds Spotify and yt-dlp download buttons under YouTube video titles. Copies yt-dlp command to clipboard for now (can be pasted into terminal). Works on modern 2025 YouTube layout with dynamic navigation support.
// @author       akavi
// @match        https://www.youtube.com/watch*
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
    'use strict';

    let currentTitleText = '';

    // --- Begin: Helpers for CarouselLockups lookup ---

    // Obtain YouTube app data
    function getYtdAppData() {
        try {
            const ytdApp = document.querySelector('ytd-app');
            if (!ytdApp) return null;
            // Depending on YouTube version, data may be in __data.data or data
            return (ytdApp.__data && ytdApp.__data.data) || ytdApp.data || null;
        } catch (e) {
            return null;
        }
    }


    function getSimpleText(defaultMetadata) {
        if (!defaultMetadata) return null;
        if (typeof defaultMetadata.simpleText === 'string') {
            return defaultMetadata.simpleText;
        }
        if (defaultMetadata.runs) {
            const texts = defaultMetadata.runs.map(entry => entry.text).filter(t => typeof t === 'string');
            if (texts.length === 1) return texts[0];
            return texts.join('');
        }
        return null;
    }

    function removeEmojis(str) {
        if (!str) return str;
        return str.replace(/[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{1F004}\u{1F0CF}\u{E0020}-\u{E007F}\u{FE0F}]/gu, '');
    }

    function simpleTextFixup(text) {
        return text.replace(/だ/g, 'だ');
    }

    function titleFix(text) {
        return text.replace(/\(([A-Za-z][a-z]+) ([Vv]ersion|[Vv]er\.?)\)/g, '($1)');
    }

    // Returns { singer, song } if exactly one carouselLockup entry found; else null
    function getMusicTitleAndAuthor(pData) {
        if (!pData || !pData.response) return null;
        const panels = pData.response.engagementPanels || [];
        let carouselLockups = null;

        // 🔍 Scan every panel → every item for the music section
        for (const ep of panels) {
            const items = ep.engagementPanelSectionListRenderer
            ?.content.structuredDescriptionContentRenderer
            ?.items || [];
            for (const item of items) {
                const lockup = item.videoDescriptionMusicSectionRenderer
                ?.carouselLockups;
                if (lockup) {
                    carouselLockups = lockup;
                    break;
                }
            }
            if (carouselLockups) break;
        }

        // If exactly one song listed, extract artist & song
        if (carouselLockups && carouselLockups.length === 1) {
            let rawA1, rawA2;
            try {
                rawA1 = carouselLockups[0].carouselLockupRenderer
                    .infoRows[0].infoRowRenderer.defaultMetadata;
                rawA2 = carouselLockups[0].carouselLockupRenderer
                    .infoRows[1].infoRowRenderer.defaultMetadata;
            } catch {
                return null;
            }

            const a1 = getSimpleText(rawA1);
            const a2 = getSimpleText(rawA2);
            if (a1 && a2) {
                // Clean and normalize
                const song = titleFix(simpleTextFixup(removeEmojis(a1).trim().replace(/\s+/g, ' ')));
                const singer = simpleTextFixup(a2).trim();
                return { singer, song };
            }
        }

        return null;
    }
    // --- End: CarouselLockups helpers ---

    function cleanTitle(title) {
        return title
        // Remove emojis
        .replace(/[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{1F004}\u{1F0CF}\u{E0020}-\u{E007F}\u{FE0F}]/gu, '')

        // Normalize zero-width/control spaces
        .replace(/[\u180E\u200B-\u200D\u2060\uFEFF]+/g, '')
        // Collapse whitespace runs
        .replace(/[\s\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028-\u2029\u202F\u205F\u3000\u00B7\u237D\u2420\u2422\u2423]+/g, ' ')

        // Normalize different dash types to hyphen
        .replace(/[–—−]/g, '-')

        // Normalize dividers
        .replace(/│/g, '|')

        // Convert Japanese/fullwidth brackets to [ ]
        .replace(/【([^【】]+)】/g, '[$1]')
        .replace(/『([^『』]+)』/g, '[$1]')
        // Keep Japanese quotes 「」 for detection earlier

        // Normalize parentheses to [ ]
        .replace(/\(([^()]+)\)/g, '[$1]')

        // Remove [ ... ] or ( ... ) if they contain fluff terms
        .replace(/\[(?=[^\]]*(?:official|mv|music|nmv|lyric|lyrics|video|live|subs|clean|ver(?:sion)?|pinyin|karaoke|4k|1080p|uhd|performance|promotion))[^]]*\]/gi, '')
        .replace(/\((?=[^)]*(?:official|mv|music|nmv|lyric|lyrics|video|live|subs|clean|ver(?:sion)?|pinyin|karaoke|4k|1080p|uhd|performance|promotion))[^)]*\)/gi, '')

        // Remove standalone fluff words
        .replace(/\b(?:official|mv|m\/v|music|nmv|lyric|lyrics|video|subs|karaoke|performance|promotion|live|clean|ver(?:sion)?|uhd|4k|1080p)\b/gi, '')

        // Remove trailing slashes
        .replace(/[／/]\s*$/g, '')

        // Remove redundant double hyphens
        .replace(/-\s*-\s*/g, '-')

        // Normalize " - " spacing
        .replace(/\s*-\s*/g, ' - ')

        // Collapse leftover spaces
        .replace(/\s{2,}/g, ' ')
        .trim();
    }

    function parseTitleAndArtist(rawTitle) {
        const t0 = rawTitle.trim();

        // 1️⃣ Try Modern Music Metadata Panel first
        const pData = getYtdAppData();
        const info = getMusicTitleAndAuthor(pData);
        if (info) {
            return {
                artist: info.singer,
                song: info.song
            };
        }

        // 2️⃣ Japanese-style quotes/brackets
        {
            const mJP = t0.match(/(?:.*[\/│]\s*)?(.+?)\s*[「『](.+?)[」』]/);
            if (mJP) {
                return {
                    artist: mJP[1].trim(),
                    song: mJP[2].trim()
                };
            }
        }

        // 3️⃣ Remove leading [prefix]
        let t = t0.replace(/^\[[^\]]+\]\s*/g, '');

        // 4️⃣ Clean title
        const cleaned = cleanTitle(t);

        // 5️⃣ Underscore pattern: artist_song
        if (cleaned.includes('_')) {
            const [artistRaw, songRaw] = cleaned.split('_', 2);
            const artist = parseArtistFromPart(artistRaw.trim());
            const song = parseSongFromPart(songRaw.trim());
            if (artist || song) {
                return { artist, song };
            }
        }

        // 6️⃣ Quoted song title
        {
            const mQuoted = cleaned.match(/^(.+?)\s*["“”‘’'`´]+(.+?)["“”‘’'`´]+/);
            if (mQuoted) {
                return {
                    artist: mQuoted[1].trim(),
                    song: mQuoted[2].trim()
                };
            }
        }

        // 7️⃣ [Artist] Song
        {
            const mBracketedArtist = cleaned.match(/^\[([^\]]+)\]\s*(.+)$/);
            if (mBracketedArtist) {
                return {
                    artist: mBracketedArtist[1].trim(),
                    song: mBracketedArtist[2].trim()
                };
            }
        }

        // 8️⃣ Artist - Song
        if (cleaned.includes(' - ')) {
            const [artistPart, songPart] = cleaned.split(' - ', 2);
            return {
                artist: artistPart.trim(),
                song: songPart.trim()
            };
        }

        // 9️⃣ Artist | Song
        if (cleaned.includes('|')) {
            const [artistPart, songPart] = cleaned.split('|', 2);
            return {
                artist: artistPart.trim(),
                song: songPart.trim()
            };
        }

        // 🔟 Song by Artist
        {
            const mBy = cleaned.match(/^(.+?)\s+by\s+(.+?)$/i);
            if (mBy) {
                return {
                    artist: mBy[2].trim(),
                    song: mBy[1].trim()
                };
            }
        }

        // Fallback
        return {
            artist: '',
            song: cleaned
        };
    }

    // Helpers for underscore parsing
    function parseArtistFromPart(part) {
        const m = part.match(/^(.+?)\(([^)]+)\)$/);
        if (m) {
            const pre = m[1].trim();
            const inside = m[2].trim();
            if (/[A-Za-z]/.test(pre)) {
                return pre + '(' + inside + ')';
            } else {
                return inside;
            }
        }
        return part.trim();
    }

    function parseSongFromPart(part) {
        const m = part.match(/^(.+?)\(([^)]+)\)/);
        if (m) {
            const pre = m[1].trim();
            const inside = m[2].trim();
            if (/[A-Za-z]/.test(pre)) {
                return pre + ' (' + inside + ')';
            } else {
                return inside;
            }
        }
        const noDate = part.replace(/\b\d{4,}.*$/,'').trim();
        return noDate || part.trim();
    }
/*
    function cleanTitle(title) {
        return title

        // Remove ( ... ) ONLY if it contains known fluff terms (case-insensitive)
        .replace(/\((?=[^)]*(official|mv|music|nmv|lyric|lyrics|video|live|subs|clean|ver|4k|pinyin))[^)]*\)/gi, '')

        // Remove [ ... ] ONLY if it contains known fluff terms (case-insensitive)
        .replace(/\[(?=[^\]]*(official|mv|music|nmv|lyric|lyrics|video|live|subs|clean|ver|4k|pinyin))[^\]]*\]/gi, '')

        // Removes the word "MV" (Music Video), case-insensitive, when it's a standalone word
        .replace(/\b(official|mv|m\/v|music|nmv|lyric|lyrics|video|subs)\b/gi, '')

        // Normalize extra spaces
        .replace(/\s{2,}/g, ' ')
        .trim();
    }
*/



    function createButton(label, color, onClick) {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.marginLeft = '12px';
        btn.style.padding = '4px 10px';
        btn.style.fontSize = '16px';
        btn.style.border = 'none';
        btn.style.borderRadius = '4px';
        btn.style.cursor = 'pointer';
        btn.style.background = color;
        btn.style.color = 'white';
        btn.style.fontWeight = '500';
        btn.style.position = 'relative';
        btn.style.top = '-2px';
        btn.onclick = onClick;
        return btn;
    }

    // Updates the buttons each time the video changes or loads
    function updateButtons() {
        const titleElem = document.querySelector('ytd-watch-metadata h1 > yt-formatted-string');
        if (!titleElem) return;

        const newTitle = titleElem.textContent.trim();
        if (newTitle === currentTitleText) return;

        currentTitleText = newTitle;
        const parent = titleElem.parentElement;

        // Remove old buttons if any
        ['spotify-search-button', 'yt-dlp-download-button', 'yt-dlp-audio-button'].forEach(id => {
            const existing = document.getElementById(id);
            if (existing) existing.remove();
        });


//#############################################################

        // Spotify
        const { artist, song } = parseTitleAndArtist(newTitle);
        const cleanedTitle = artist
            ? `${artist} ${song}`
            : song;
        const spotifyBtn = createButton('🎧 Spotify', '#1DB954', () => {
            const url = `https://open.spotify.com/search/${encodeURIComponent(cleanedTitle)}`;
            window.open(url, '_blank');
        });
        spotifyBtn.id = 'spotify-search-button';


//#############################################################

        // yt-dlp
        const videoUrl = window.location.href;
        const ytDlpBtn = createButton('Video DL', '#FF4C4C', () => {
            const command = `yt-dlp -f "bv*+ba/best" --embed-metadata --embed-thumbnail --no-playlist --write-subs --sub-lang en --embed-subs -o "$HOME/Downloads/%(title)s - %(uploader)s.%(ext)s" "${videoUrl}"`;
            GM_setClipboard(command, 'text');
            //alert('Copied yt-dlp command to clipboard:\n\n' + command);
        });
        ytDlpBtn.id = 'yt-dlp-download-button';


//#############################################################

        // yt-dlp audio only
        const audioUrl = window.location.href;
        const ytDlpAudioBtn = createButton('Audio DL', '#FCA311', () => {
            const command = `yt-dlp -f bestaudio --embed-metadata --embed-thumbnail -o "$HOME/Downloads/%(title)s - %(uploader)s.%(ext)s" "${videoUrl}"`;
            GM_setClipboard(command, 'text');

        });
        ytDlpAudioBtn.id = 'yt-dlp-audio-button';


//#############################################################

        parent.appendChild(spotifyBtn);
        parent.appendChild(ytDlpBtn);
        parent.appendChild(ytDlpAudioBtn);
    }

    // Observe YouTube's dynamic page changes (SPA-style)
    function initObservers() {
        const target = document.querySelector('ytd-app');
        if (!target) return;

        const observer = new MutationObserver(() => updateButtons());
        observer.observe(target, { childList: true, subtree: true });

        // Also trigger update on standard events
        window.addEventListener('yt-navigate-finish', updateButtons);
        window.addEventListener('load', updateButtons);
    }

    initObservers();
})();
