// Health check monitoring
function checkHealth() {
    fetch('/health')
        .then(response => {
            const statusDot = document.querySelector('.status-dot');
            const statusText = document.querySelector('.status-text');

            if (response.ok) {
                statusDot.style.backgroundColor = '#27ae60';
                statusText.textContent = 'Online';
                statusText.style.color = '#27ae60';
            } else {
                statusDot.style.backgroundColor = '#e74c3c';
                statusText.textContent = 'Degraded';
                statusText.style.color = '#e74c3c';
            }
        })
        .catch(error => {
            const statusDot = document.querySelector('.status-dot');
            const statusText = document.querySelector('.status-text');

            statusDot.style.backgroundColor = '#e74c3c';
            statusText.textContent = 'Offline';
            statusText.style.color = '#e74c3c';

            console.error('Health check failed:', error);
        });
}

// Check health on page load
document.addEventListener('DOMContentLoaded', function() {
    checkHealth();

    // Refresh health status every 30 seconds
    setInterval(checkHealth, 30000);
});

// Add smooth scrolling for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});
