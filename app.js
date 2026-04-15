class App {
    constructor() {
        this.currentViewId = 'view-start';
        this.userLocation = null;
        this.watchId = null;
        this.map = null;
        this.userMarker = null;
        this.locationMarkers = {};
        this.activeLocation = null;
        this.apiState = this.loadState();
        this.isPlaying = false;
        this.playerOverlay = document.getElementById('player-overlay');
        this.audioElement = document.getElementById('audio-player');

        this.init();
    }

    init() {
        // Setup List View
        this.renderListView();

        // Audio listener to mark as played when ended
        this.audioElement.addEventListener('ended', () => {
            this.isPlaying = false;
            document.getElementById('play-pause-btn').innerHTML = '<div class="play-icon"></div>';
            if (this.activeLocation) {
                this.markAsListened(this.activeLocation.id);
            }
        });
    }

    loadState() {
        const stored = localStorage.getItem('inBetweenBeingState');
        return stored ? JSON.parse(stored) : { listened: [] };
    }

    saveState() {
        localStorage.setItem('inBetweenBeingState', JSON.stringify(this.apiState));
    }

    markAsListened(locationId) {
        if (!this.apiState.listened.includes(locationId)) {
            this.apiState.listened.push(locationId);
            this.saveState();
            this.renderListView(); // refresh UI
        }
    }

    navigateTo(viewId) {
        // Handle bottom nav active states
        document.querySelectorAll('.bottom-nav button').forEach(btn => btn.classList.remove('active'));
        if (viewId === 'view-start') {
            document.querySelectorAll('.bottom-nav button:nth-child(1)').forEach(btn => btn.classList.add('active'));
        } else if (viewId === 'view-map' || viewId === 'view-list') {
            document.querySelectorAll('.bottom-nav button:nth-child(2)').forEach(btn => btn.classList.add('active'));
            // Default sub-tab is map
            if (viewId === 'view-map' && !this.map) {
                // Initialize map if navigating to it for the first time
                setTimeout(() => this.initMap(), 100);
            }
        } else if (viewId === 'view-about') {
            document.querySelectorAll('.bottom-nav button:nth-child(3)').forEach(btn => btn.classList.add('active'));
        }

        // Switch views
        document.querySelectorAll('.view').forEach(view => {
            view.classList.remove('active');
            view.classList.add('hidden');
        });
        const targetView = document.getElementById(viewId);
        targetView.classList.remove('hidden');
        targetView.classList.add('active');

        this.currentViewId = viewId;

        // Ensure map resizes correctly when revealed
        if (viewId === 'view-map' && this.map) {
            this.map.invalidateSize();
        }
    }

    switchTab(tab) {
        if (tab === 'map') {
            this.navigateTo('view-map');
        } else {
            this.navigateTo('view-list');
        }
    }

    requestLocation() {
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    this.userLocation = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    };
                    this.startWatchingLocation();
                    this.navigateTo('view-map');
                },
                (error) => {
                    console.error("Location error", error);
                    this.navigateTo('view-no-permission');
                },
                { enableHighAccuracy: true }
            );
        } else {
            alert("Geolocation is not supported by your browser");
        }
    }

    startWatchingLocation() {
        if (this.watchId) return;
        this.watchId = navigator.geolocation.watchPosition(
            (position) => {
                this.userLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                this.updateUserMarker();
                this.checkProximities();
            },
            (error) => console.error("Watch position error", error),
            { enableHighAccuracy: true, maximumAge: 0 }
        );
    }

    initMap() {
        if (this.map) return;

        // Center on Zurich initially
        const centerLat = this.userLocation ? this.userLocation.lat : 47.3769;
        const centerLng = this.userLocation ? this.userLocation.lng : 8.5417;

        this.map = L.map('map-container', { zoomControl: false }).setView([centerLat, centerLng], 13);

        // Add minimalist tile layer (CartoDB Positron, will be inverted to dark in CSS)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; CartoDB'
        }).addTo(this.map);

        // Add markers for all locations
        locationsData.forEach(loc => {
            const marker = L.circleMarker([loc.lat, loc.lng], {
                radius: 8,
                fillColor: '#ffffff',
                color: '#ffffff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8
            }).addTo(this.map);

            marker.on('click', () => {
                this.openLocationDetails(loc);
            });

            // 100 meter radius circle showing the listening area
            const circle = L.circle([loc.lat, loc.lng], {
                radius: 50,
                fillColor: '#ffffff',
                color: '#ffffff',
                weight: 1,
                opacity: 0.3,
                fillOpacity: 0.1,
                interactive: false
            });
            loc.circle = circle;

            this.locationMarkers[loc.id] = marker;
        });

        // Add zoom listener to toggle visibility of 100m circles
        this.map.on('zoomend', () => {
            const currentZoom = this.map.getZoom();
            const threshold = 15; // Show circles only when zooming in
            if (currentZoom >= threshold) {
                locationsData.forEach(loc => {
                    if (!this.map.hasLayer(loc.circle)) {
                        loc.circle.addTo(this.map);
                    }
                });
            } else {
                locationsData.forEach(loc => {
                    if (this.map.hasLayer(loc.circle)) {
                        this.map.removeLayer(loc.circle);
                    }
                });
            }
        });

        // Trigger zoomend manually once to set initial visibility states
        this.map.fire('zoomend');

        if (this.userLocation) {
            this.updateUserMarker();
        }
    }

    updateUserMarker() {
        if (!this.map || !this.userLocation) return;

        if (!this.userMarker) {
            this.userMarker = L.circleMarker([this.userLocation.lat, this.userLocation.lng], {
                radius: 10,
                fillColor: '#4a4eb8',
                color: '#fff',
                weight: 3,
                opacity: 1,
                fillOpacity: 1
            }).addTo(this.map);
        } else {
            this.userMarker.setLatLng([this.userLocation.lat, this.userLocation.lng]);
        }
    }

    // Haversine formula to get distance in meters
    getDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3; // metres
        const φ1 = lat1 * Math.PI / 180; // φ, λ in radians
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }

    checkProximities() {
        if (!this.userLocation || !this.activeLocation) return;

        const dist = this.getDistance(
            this.userLocation.lat, this.userLocation.lng,
            this.activeLocation.lat, this.activeLocation.lng
        );

        const statusEl = document.getElementById('player-status');
        const playBtn = document.getElementById('play-pause-btn');

        if (dist <= 200) {
            statusEl.innerText = "You are within range. Tap to play.";
            playBtn.style.opacity = "1";
            playBtn.style.pointerEvents = "auto";
        } else {
            statusEl.innerText = `Stay within a 200m distance to listen to the full piece. (${Math.round(dist)}m away)`;
            playBtn.style.opacity = "0.5";
            playBtn.style.pointerEvents = "none";
            // If dragging away while playing, pause it
            if (this.isPlaying) {
                this.togglePlay();
            }
        }
    }

    openLocationDetails(loc) {
        this.activeLocation = loc;
        document.getElementById('player-title').innerText = loc.name;
        this.audioElement.src = loc.audioUrl;

        // Reset player UI
        this.isPlaying = false;
        document.getElementById('play-pause-btn').innerHTML = '<div class="play-icon"></div>';

        // Show player
        this.playerOverlay.classList.remove('hidden');
        // Give slight delay for css display block to kick in before transform animation
        setTimeout(() => {
            this.playerOverlay.classList.add('active');
            if (this.userLocation) {
                this.checkProximities();
                // Check if user clicked from afar, distance might be large
            } else {
                document.getElementById('player-status').innerText = "Location unknown. Grant GPS to check distance.";
            }
        }, 10);
    }

    closePlayer() {
        this.playerOverlay.classList.remove('active');
        if (this.isPlaying) {
            this.togglePlay();
        }
        setTimeout(() => {
            this.playerOverlay.classList.add('hidden');
            this.activeLocation = null;
        }, 400); // match css transition
    }

    togglePlay() {
        const playBtn = document.getElementById('play-pause-btn');
        if (this.isPlaying) {
            this.audioElement.pause();
            playBtn.innerHTML = '<div class="play-icon"></div>';
        } else {
            this.audioElement.play();
            playBtn.innerHTML = '<div class="pause-icon"></div>';
            // Mark as listened basically as soon as they start/or when it ends. Lets just do it when it ends.
        }
        this.isPlaying = !this.isPlaying;
    }

    openGoogleMapsNav(lat, lng) {
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
    }

    renderListView() {
        const container = document.getElementById('list-container');
        container.innerHTML = '';

        // Group by area
        const grouped = {};
        locationsData.forEach(loc => {
            if (!grouped[loc.area]) grouped[loc.area] = [];
            grouped[loc.area].push(loc);
        });

        for (const [area, locs] of Object.entries(grouped)) {
            const areaSection = document.createElement('div');
            areaSection.className = 'list-area';
            areaSection.innerHTML = `<h3>${area}</h3>`;

            locs.forEach(loc => {
                const isListened = this.apiState.listened.includes(loc.id);
                const locItem = document.createElement('div');
                locItem.className = 'location-item';
                locItem.innerHTML = `
                    <div class="location-info">
                        <h4>${loc.name}</h4>
                        <button class="navigate-btn" onclick="app.openGoogleMapsNav(${loc.lat}, ${loc.lng})">open navigation</button>
                    </div>
                    <div>
                        ${isListened ? '<span class="status-badge listened">Listened</span>' : `<span style="font-size: 0.8rem; color:var(--text-secondary)">${loc.duration}</span>`}
                    </div>
                `;
                // If we also want them to be able to click on the list to open the player overlay on map
                locItem.querySelector('.location-info h4').onclick = () => {
                    this.switchTab('map');
                    this.openLocationDetails(loc);
                };
                locItem.querySelector('.location-info h4').style.cursor = 'pointer';

                areaSection.appendChild(locItem);
            });

            container.appendChild(areaSection);
        }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
