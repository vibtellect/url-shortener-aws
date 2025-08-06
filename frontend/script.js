// Dashboard functionality
let dashboardInterval;

// Initialize dashboard
function initDashboard() {
    updateDashboard();
    dashboardInterval = setInterval(updateDashboard, 5000); // Update every 5 seconds
}

// Update dashboard metrics
function updateDashboard() {
    fetch('/metrics')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            document.getElementById('totalUrls').textContent = data.urls_created || 0;
            document.getElementById('totalClicks').textContent = data.urls_accessed || 0;
            document.getElementById('uniqueVisitors').textContent = data.unique_visitors || 0;
            document.getElementById('activeUrls').textContent = data.active_urls || 0;
            
            // Remove error state if it exists
            const dashboard = document.querySelector('.dashboard');
            dashboard.classList.remove('error');
        })
        .catch(error => {
            console.error('Error fetching dashboard data:', error);
            
            // Show error state in dashboard
            const dashboard = document.querySelector('.dashboard');
            dashboard.classList.add('error');
            
            // Optionally show a toast notification for the first error
            if (!dashboard.dataset.errorShown) {
                showToast('Dashboard-Daten konnten nicht geladen werden', 'error');
                dashboard.dataset.errorShown = 'true';
            }
        });
}

// Show toast notification
function showToast(message, type = 'info') {
    // Remove existing toasts
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
        existingToast.remove();
    }
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toast.id = 'toast';
    
    document.body.appendChild(toast);
    
    // Show toast
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    
    // Hide toast after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 300);
    }, 3000);
}

// Show loading animation
function showLoading(element) {
    element.innerHTML = '<span class="loading"></span>';
}

document.getElementById('shortenForm').addEventListener('submit', function(event) {
    event.preventDefault();
    var url = document.getElementById('url').value;
    var submitBtn = document.querySelector('button[type="submit"]');
    var resultDiv = document.getElementById('result');
    
    // Show loading state
    const originalBtnText = submitBtn.textContent;
    submitBtn.innerHTML = '<span class="loading"></span> Wird gekürzt...';
    submitBtn.disabled = true;
    
    fetch('/create', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url: url })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            throw new Error(data.error);
        }
        
        const shortUrl = data.short_url;
        resultDiv.innerHTML = `
            <div>
                <strong>Gekürzte URL:</strong><br>
                <span class="shortened-url" onclick="copyToClipboard('${shortUrl}')">${shortUrl}</span>
                <button class="copy-btn" onclick="copyToClipboard('${shortUrl}')">Kopieren</button>
            </div>
        `;
        resultDiv.classList.add('show');
        
        // Show success toast
        showToast('URL erfolgreich gekürzt!', 'success');
        
        // Reset button
        submitBtn.textContent = originalBtnText;
        submitBtn.disabled = false;
        
        // Update dashboard
        updateDashboard();
    })
    .catch(error => {
        console.error('Error:', error);
        resultDiv.innerHTML = `<div style="color: red;">Fehler beim Kürzen der URL: ${error.message || 'Bitte versuchen Sie es erneut.'}</div>`;
        resultDiv.classList.add('show');
        
        // Show error toast
        showToast('Fehler beim Kürzen der URL!', 'error');
        
        // Reset button
        submitBtn.textContent = originalBtnText;
        submitBtn.disabled = false;
    });
});

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(function() {
        // Show success message
        var copyBtns = document.querySelectorAll('.copy-btn');
        copyBtns.forEach(btn => {
            const originalText = btn.textContent;
            btn.textContent = 'Kopiert!';
            btn.style.background = '#28a745';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.background = '';
            }, 2000);
        });
        
        // Show success toast
        showToast('URL in Zwischenablage kopiert!', 'success');
    }).catch(function(err) {
        console.error('Fehler beim Kopieren: ', err);
        showToast('Fehler beim Kopieren!', 'error');
    });
}

// Initialize dashboard when page loads
document.addEventListener('DOMContentLoaded', function() {
    initDashboard();
});
