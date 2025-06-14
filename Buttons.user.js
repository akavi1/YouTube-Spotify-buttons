// ==UserScript==
// @name         YouTube Spotify + Download Buttons
// @namespace    http://tampermonkey.net/
// @version      1.8
// @description  Adds Spotify and yt-dlp download buttons under YouTube video titles. Copies yt-dlp command to clipboard for now (can be pasted into terminal). Works on modern 2025 YouTube layout with dynamic navigation support.
// @author       akavi
// @match        https://www.youtube.com/watch*
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
    'use strict';

    let currentTitleText = '';

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
        const cleanedTitle = cleanTitle(newTitle);
        const spotifyBtn = createButton('🎧 Spotify', '#1DB954', () => {
            const url = `https://open.spotify.com/search/${encodeURIComponent(cleanedTitle)}`;
            window.open(url, '_blank');
        });
        spotifyBtn.id = 'spotify-search-button';


//#############################################################

        // yt-dlp
        const videoUrl = window.location.href;
        const ytDlpBtn = createButton('Video DL', '#FF4C4C', () => {
            const command = `yt-dlp -f "bv*+ba/best" --embed-metadata --embed-thumbnail -o "$HOME/Downloads/%(title)s - %(uploader)s.%(ext)s" "${videoUrl}"`;
            GM_setClipboard(command, 'text');
            //alert('Copied yt-dlp command to clipboard:\n\n' + command);
        });
        ytDlpBtn.id = 'yt-dlp-download-button';


//#############################################################

        // yt-dlp audio only
        const audioUrl = window.location.href;
        const ytDlpAudioBtn = createButton('Audio DL', '#FCA311', () => {
            const command = `yt-dlp -f bestaudio --extract-audio --audio-format mp3 --embed-metadata --embed-thumbnail -o "$HOME/Downloads/%(title)s - %(uploader)s.%(ext)s" "${videoUrl}"`;
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
