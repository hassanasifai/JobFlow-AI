{
  description = "career-ops - AI job search pipeline";

  # nixpkgs is pinned to a specific commit so devShells are reproducible across
  # contributors and across time. Bump deliberately with `nix flake update`.
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/0726a0ecb6d4e08f6adced58726b95db924cef57";
    flakelight.url = "github:nix-community/flakelight";
  };

  outputs =
    { flakelight, nixpkgs, ... }:
    flakelight ./. {

      inputs.nixpkgs = nixpkgs;

      devShell.packages =
        pkgs: with pkgs; [

          nodejs
          bun

          coreutils

          playwright-driver.browsers

        ];

      devShell.env = pkgs: {
        PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
        PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
      };

      devShell.shellHook = pkgs: ''
        # Pin npm playwright to match nixpkgs browser binaries
        EXPECTED="${pkgs.playwright-driver.version}"
        CURRENT=$(node -e "try{console.log(require('playwright-core/package.json').version)}catch{}" 2>/dev/null)
        if [ "$CURRENT" != "$EXPECTED" ]; then
          echo "Pinning playwright to $EXPECTED to match Nix-provided browsers..."
          npm install --no-save "playwright@$EXPECTED" >/dev/null 2>&1
        fi
      '';

    };

}
