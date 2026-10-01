"""
Writes the Content-Security-Policy for the staged accounts site (called by server/stage.sh).

The two apps are single files with inline <script> blocks, so instead of 'unsafe-inline' each block is
allowed by its SHA-256 hash: any other script (an injected one, say) won't run. The hashes change with
every build, which is why this runs at staging time rather than living in .htaccess by hand.

Usage: python3 server/csp.py <staged public_html/crows> <staged crows-app>
"""
import base64
import hashlib
import os
import re
import sys

COMMON = ("default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; "
          "connect-src 'self'; manifest-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'; object-src 'none'")


def app_policy(path, extra=''):
    with open(path, encoding='utf-8') as f:
        html = f.read()
    blocks = re.findall(r'<script>(.*?)</script>', html, flags=re.S)
    assert blocks and not re.search(r'<script[^>]*\ssrc=', html), path
    hashes = ["'sha256-%s'" % base64.b64encode(hashlib.sha256(b.encode('utf-8')).digest()).decode() for b in blocks]
    return "script-src %s; %s%s" % (' '.join(hashes), extra, COMMON)


def main():
    public, app = sys.argv[1], sys.argv[2]
    gen = app_policy(os.path.join(public, 'Crows_Character_Generator.html'))
    # The Ref Screen's Party tab embeds each linked crow's live Vitals (the generator, same origin).
    ref = app_policy(os.path.join(app, 'Crows_Ref_Screen.html'), "frame-src 'self'; ")
    portal = "script-src 'self'; " + COMMON
    block = ('<IfModule mod_headers.c>\n'
             '  <Files "index.html">\n    Header always set Content-Security-Policy "%s"\n  </Files>\n'
             '  <Files "Crows_Character_Generator.html">\n    Header always set Content-Security-Policy "%s"\n  </Files>\n'
             '</IfModule>' % (portal, gen))
    ht = os.path.join(public, '.htaccess')
    with open(ht, encoding='utf-8') as f:
        text = f.read()
    assert '# @CSP@' in text
    with open(ht, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text.replace('# @CSP@', block))
    with open(os.path.join(app, 'ref-csp.txt'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(ref)
    print('CSP written (%d generator scripts, %d Ref Screen scripts)' % (gen.count('sha256-'), ref.count('sha256-')))


if __name__ == '__main__':
    main()
