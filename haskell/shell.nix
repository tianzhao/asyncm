{ nixpkgs ? import <nixpkgs> {} }:

let
  inherit (nixpkgs) pkgs;
  inherit (pkgs) haskellPackages;

  ghc = haskellPackages.ghcWithPackages (ps: with ps; [
    base
    async
    containers
    clock
  ]);
in
  pkgs.stdenv.mkDerivation {
    name = "env";
    buildInputs = [
      ghc
    ];
  }

