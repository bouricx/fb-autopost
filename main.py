import threading
import webbrowser
import uvicorn
from autopost.runtime_config import PORT

if __name__ == '__main__':
    print(f'FB AutoPost: http://127.0.0.1:{PORT}')
    print('Keep this window open for scheduled jobs. Ctrl+C stops the app.')
    threading.Timer(2, lambda: webbrowser.open(f'http://127.0.0.1:{PORT}')).start()
    uvicorn.run('autopost.api:app', host='127.0.0.1', port=PORT, access_log=False)
