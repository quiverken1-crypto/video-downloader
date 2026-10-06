
import win32crypt, json, os, sqlite3, shutil, tempfile, base64
from Cryptodome.Cipher import AES
from Cryptodome.Hash import SHA256

def extract_instagram_cookies(output_path):
    """Extract Instagram cookies from Chrome and save as Netscape format"""
    ls_path = os.path.expanduser("~") + "/AppData/Local/Google/Chrome/User Data/Local State"
    cookie_path = os.path.expanduser("~") + "/AppData/Local/Google/Chrome/User Data/Default/Network/Cookies"
    
    if not os.path.exists(cookie_path):
        return False, "Chrome cookie database not found"
    
    with open(ls_path) as f:
        ls = json.load(f)
    enc_key = base64.b64decode(ls["os_crypt"]["encrypted_key"])
    master_key = win32crypt.CryptUnprotectData(enc_key[5:], None, None, None, 0)[1]
    
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    shutil.copy2(cookie_path, tmp.name); tmp.close()
    
    conn = sqlite3.connect(tmp.name)
    cur = conn.cursor()
    cur.execute("SELECT host_key, name, encrypted_value FROM cookies WHERE host_key LIKE '%.instagram.com%'")
    rows = cur.fetchall()
    conn.close()
    os.unlink(tmp.name)
    
    if not rows:
        return False, "No Instagram cookies found. Login to Instagram in Chrome first."
    
    lines = ["# Netscape HTTP Cookie File"]
    success = 0
    for domain, name, ev in rows:
        for key_name, key, nonce_offsets in [
            ("master", master_key, [(3,12), (5,12), (3,16)]),
        ]:
            if len(ev) < 20:
                continue
            for no, nl in nonce_offsets:
                try:
                    nonce = ev[no:no+nl]
                    tag_start = len(ev) - 16
                    ct = ev[no+nl:tag_start]
                    tag = ev[tag_start:]
                    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
                    value = cipher.decrypt_and_verify(ct, tag).decode()
                    lines.append(f"{domain}	TRUE	/	FALSE	0	{name}	{value}")
                    success += 1
                    break
                except:
                    continue
            else:
                continue
            break
    
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("
".join(lines))
    
    return True, f"Saved {success} cookies to {output_path}"

if __name__ == "__main__":
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else "cookies.txt"
    success, msg = extract_instagram_cookies(out)
    print(msg)
    sys.exit(0 if success else 1)
