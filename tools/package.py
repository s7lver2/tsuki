import os
import fnmatch
import zipfile

def should_ignore(rel_path, ignore_patterns, is_dir=False):
    rel_path = rel_path.replace(os.sep, '/')
    for pattern in ignore_patterns:
        pattern = pattern.strip().replace(os.sep, '/')
        if not pattern or pattern.startswith('#'):
            continue
        
        pattern_is_dir = pattern.endswith('/')
        if pattern_is_dir and not is_dir:
            continue
        
        test_path = rel_path
        if pattern_is_dir:
            test_path += '/'
        
        if '/' in pattern:
            if pattern.startswith('/'):
                match_pattern = pattern.lstrip('/')
                if fnmatch.fnmatch(test_path, match_pattern):
                    return True
            else:
                if fnmatch.fnmatch(test_path, pattern) or fnmatch.fnmatch(test_path, '*/' + pattern):
                    return True
        else:
            if fnmatch.fnmatch(os.path.basename(test_path), pattern):
                return True
    return False

def zip_directory(dir_path='.', zip_path='archive.zip', additional_ignores=[]):
    # Read .gitignore if it exists
    gitignore_path = os.path.join(dir_path, '.gitignore')
    ignore_patterns = []
    if os.path.exists(gitignore_path):
        with open(gitignore_path, 'r') as f:
            ignore_patterns = [line.strip() for line in f if line.strip() and not line.startswith('#')]
    
    # Always ignore .git by default, plus additional ignores
    ignore_patterns += ['.git/'] + additional_ignores
    
    # Count total files to add for progress (optional, but helps to show activity)
    total_files = 0
    for root, dirs, files in os.walk(dir_path):
        rel_root = os.path.relpath(root, dir_path)
        
        # Filter directories
        dirs[:] = [d for d in dirs if not should_ignore(os.path.normpath(os.path.join(rel_root, d)), ignore_patterns, is_dir=True)]
        
        for file in files:
            abs_path = os.path.join(root, file)
            rel_path = os.path.normpath(os.path.relpath(abs_path, dir_path))
            if not should_ignore(rel_path, ignore_patterns, is_dir=False):
                total_files += 1
    
    print(f"Found {total_files} files to archive.")
    
    # Create the zip file with no compression for speed
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_STORED) as zipf:  # Changed to ZIP_STORED for faster execution
        added = 0
        for root, dirs, files in os.walk(dir_path):
            rel_root = os.path.relpath(root, dir_path)
            
            # Filter directories
            dirs[:] = [d for d in dirs if not should_ignore(os.path.normpath(os.path.join(rel_root, d)), ignore_patterns, is_dir=True)]
            
            for file in files:
                abs_path = os.path.join(root, file)
                rel_path = os.path.normpath(os.path.relpath(abs_path, dir_path))
                
                if should_ignore(rel_path, ignore_patterns, is_dir=False):
                    continue
                
                print(f"Adding {rel_path} ({added + 1}/{total_files})")
                zipf.write(abs_path, rel_path)
                added += 1

# Usage: zip the current directory, with optional additional ignores
if __name__ == '__main__':
    import os as _os
    _root = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
    _out  = _os.path.join(_root, 'archive.zip')
    # Example: additional_ignores = ['some_dir/', 'another_dir/file.txt']
    zip_directory(dir_path=_root, zip_path=_out, additional_ignores=[])